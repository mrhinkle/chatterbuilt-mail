import { request as httpsRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../auth.js";
import type { PassphraseCost } from "../auth/passphrase.js";
import { PAGE_STYLE, PAGE_STYLE_HASH } from "../auth/style.js";
import { loadConfig } from "../config.js";
import { openSql, type Sql } from "../store/sql.js";
import { createServer, type Running } from "./app.js";

const SECRET = "cbm-secret-setup-claim-value-32ch";
const PASS = "passphrase-for-setup-claim";
const OTHER = "other-passphrase-for-the-race";
const WRONG = "wrong-setup-secret-not-the-real-one";
const STORED = /^scrypt\$17\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
/** Tests that do not assert the production cost use this. Verify still reads the stored row. */
const FAST: PassphraseCost = { logN: 14 };

const open: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (open.length > 0) {
    const item = open.pop();
    if (item) await item.close();
  }
});

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    CBM_SECRET: SECRET,
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "fake",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    ...extra,
  };
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function locationOf(res: Answer): string {
  const value = res.headers.location;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function cookieOf(res: Answer): string {
  const value = res.headers["set-cookie"];
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  const line = lines.find((item) => item.startsWith("cbm_owner="));
  const match = /cbm_owner=([^;]+)/.exec(line ?? "");
  return match?.[1] ? `cbm_owner=${match[1]}` : "";
}

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error("csrf missing");
  return match[1];
}

function https(app: Running, method: string, path: string, options: { cookie?: string; body?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
  return new Promise((resolve, reject) => {
    const target = new URL(`${app.url}${path}`);
    const payload = Buffer.from(options.body ?? "");
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: options.body === undefined ? headers : { ...headers, "content-length": String(payload.length) },
      ca: app.cert,
      servername: "localhost",
    }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (options.body !== undefined) req.end(payload);
    else req.end();
  });
}

async function boot(
  extra: Record<string, string | undefined> = {},
  logSink?: (line: string) => void,
  passphraseCost?: PassphraseCost,
): Promise<{ app: Running; sql: Sql }> {
  const values = env(extra);
  const sql = await openSql(loadConfig(values));
  open.push(sql);
  const app = await createServer(values, {
    sql,
    logSink,
    ...(passphraseCost ? { passphraseCost } : {}),
  });
  open.push(app);
  return { app, sql };
}

async function form(app: Running): Promise<{ cookie: string; csrf: string; text: string; csp: string }> {
  const page = await https(app, "GET", "/setup");
  expect(page.status).toBe(200);
  return { cookie: cookieOf(page), csrf: csrfOf(page.text), text: page.text, csp: String(page.headers["content-security-policy"] ?? "") };
}

function claimBody(csrf: string, secret: string, passphrase: string, timezone = "", confirm = passphrase): string {
  return new URLSearchParams({ csrf, secret, passphrase, timezone, confirm }).toString();
}

async function ownerRow(sql: Sql): Promise<{ passphrase_hash: string; timezone: string | null } | undefined> {
  const result = await sql.query<{ passphrase_hash: string; timezone: string | null }>(
    "SELECT passphrase_hash, timezone FROM owner_setup WHERE id = 1",
  );
  return result.rows[0];
}

describe("/setup", () => {
  it("claims once with the right secret, signs the owner in, and then is gone", async () => {
    const lines: string[] = [];
    const { app, sql } = await boot({}, (line) => lines.push(line));
    const page = await form(app);
    const nonce = /script-src 'nonce-([^']+)'/.exec(page.csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(page.text).toContain(`nonce="${nonce}"`);
    expect(page.csp).toContain(`style-src 'sha256-${PAGE_STYLE_HASH}'`);
    expect(page.text).toContain(`<style>${PAGE_STYLE}</style>`);
    expect(page.text.includes("style=\"")).toBe(false);
    expect(page.text).toContain("Overnight checks are off");
    expect(page.text).toContain("At least 12 characters");
    expect(page.text).toContain("Confirm passphrase");
    expect(page.text).not.toContain(SECRET);

    const posted = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(page.csrf, SECRET, PASS, "America/New_York"),
    });
    expect(posted.status).toBe(302);
    expect(locationOf(posted)).toBe("/connect");
    const owner = cookieOf(posted);
    expect(owner).not.toBe("");
    expect(posted.text).not.toContain(SECRET);
    expect(posted.text).not.toContain(PASS);

    const row = await ownerRow(sql);
    expect(row?.passphrase_hash).toMatch(STORED);
    expect(row?.timezone).toBe("America/New_York");
    expect(app.config.ownerTimezone).toBe("America/New_York");
    expect(app.config.ownerTimezoneDefaulted).toBe(false);
    expect(lines.join("\n")).not.toContain(SECRET);
    expect(lines.join("\n")).not.toContain(PASS);
    expect(lines.join("\n")).toContain("setup claimed");

    expect((await https(app, "GET", "/setup")).status).toBe(404);
    const home = await https(app, "GET", "/signin", { cookie: owner });
    expect(home.status).toBe(200);
    expect(home.text).toContain("Signed in");

    const fresh = await https(app, "GET", "/signin");
    const signed = await https(app, "POST", "/signin", {
      cookie: cookieOf(fresh),
      body: new URLSearchParams({ csrf: csrfOf(fresh.text), passphrase: PASS }).toString(),
    });
    expect(signed.status).toBe(200);
    expect(signed.text).toContain("Signed in");

    const wrongPage = await https(app, "GET", "/signin");
    const wrongTry = await https(app, "POST", "/signin", {
      cookie: cookieOf(wrongPage),
      body: new URLSearchParams({ csrf: csrfOf(wrongPage.text), passphrase: "wrong-passphrase-value" }).toString(),
    });
    expect(wrongTry.status).toBe(401);
    const oneOff = `${PASS.slice(0, -1)}n`;
    const onePage = await https(app, "GET", "/signin");
    const oneTry = await https(app, "POST", "/signin", {
      cookie: cookieOf(onePage),
      body: new URLSearchParams({ csrf: csrfOf(onePage.text), passphrase: oneOff }).toString(),
    });
    expect(oneTry.status).toBe(401);
    const logged = lines.join("\n");
    expect(logged).not.toContain(PASS);
    expect(logged).not.toContain("wrong-passphrase-value");
    expect(logged).not.toContain(oneOff);
  });

  it("keeps an env time zone and refuses a second claim, a bad csrf, and a short passphrase", async () => {
    const { app, sql } = await boot({ OWNER_TIMEZONE: "Europe/London" }, undefined, FAST);
    const page = await form(app);
    const short = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(page.csrf, SECRET, "12345678901", "America/New_York"),
    });
    expect(short.status).toBe(400);
    expect(short.text).toContain("Use at least 12 characters.");
    expect(await ownerRow(sql)).toBeUndefined();

    const bad = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody("not-the-csrf", SECRET, PASS),
    });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("This form has expired.");
    expect(await ownerRow(sql)).toBeUndefined();

    const expired = await https(app, "POST", "/setup", { body: claimBody(page.csrf, SECRET, PASS) });
    expect(expired.status).toBe(400);

    const posted = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(csrfOf(short.text), SECRET, PASS, "America/New_York"),
    });
    expect(posted.status).toBe(302);
    expect((await ownerRow(sql))?.timezone).toBeNull();
    expect(app.config.ownerTimezone).toBe("Europe/London");
    expect((await https(app, "GET", "/setup", { cookie: cookieOf(posted) })).text).toContain("already has an owner");
    expect((await https(app, "PUT", "/setup")).status).toBe(404);
  });

  it("refuses a confirm mismatch without storing a row or counting a failure", async () => {
    const lines: string[] = [];
    const mismatch = "different-passphrase-value";
    const { app, sql } = await boot({}, (line) => lines.push(line), FAST);
    const page = await form(app);
    const posted = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(page.csrf, SECRET, PASS, "", mismatch),
    });
    expect(posted.status).toBe(400);
    expect(posted.text).toContain("The two passphrases don&#39;t match. Type them again.");
    expect(posted.text).not.toContain(PASS);
    expect(posted.text).not.toContain(mismatch);
    expect(await ownerRow(sql)).toBeUndefined();
    const buckets = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM passphrase_failures");
    expect(Number(buckets.rows[0]?.n)).toBe(0);
    const logged = lines.join("\n");
    expect(logged).not.toContain(PASS);
    expect(logged).not.toContain(mismatch);
    expect(logged).not.toContain(SECRET);
    const matched = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(csrfOf(posted.text), SECRET, PASS),
    });
    expect(matched.status).toBe(302);
    expect(locationOf(matched)).toBe("/connect");
    expect(await ownerRow(sql)).toBeTruthy();
  });

  it("accepts a 12-character passphrase and keeps it out of the logs", async () => {
    const lines: string[] = [];
    const phrase = "123456789012";
    const { app, sql } = await boot({}, (line) => lines.push(line), FAST);
    const page = await form(app);
    const posted = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(page.csrf, SECRET, phrase),
    });
    expect(posted.status).toBe(302);
    expect((await ownerRow(sql))?.passphrase_hash.startsWith("scrypt$14$8$1$")).toBe(true);
    const sign = await https(app, "GET", "/signin");
    const signed = await https(app, "POST", "/signin", {
      cookie: cookieOf(sign),
      body: new URLSearchParams({ csrf: csrfOf(sign.text), passphrase: phrase }).toString(),
    });
    expect(signed.status).toBe(200);
    expect(signed.text).toContain("Signed in");
    const logged = lines.join("\n");
    expect(logged).not.toContain(phrase);
    expect(logged).not.toContain(SECRET);
  });

  it("fails closed on a legacy sha256 row and a malformed row, and does not log either value", async () => {
    const lines: string[] = [];
    const phrase = "legacy-passphrase-value";
    const legacy = sha256(phrase);
    const malformed = "malformed-stored-value-should-not-log";
    const { app, sql } = await boot({}, (line) => lines.push(line));
    await sqlInsert(sql, legacy);
    const sign = await https(app, "GET", "/signin");
    const tried = await https(app, "POST", "/signin", {
      cookie: cookieOf(sign),
      body: new URLSearchParams({ csrf: csrfOf(sign.text), passphrase: phrase }).toString(),
    });
    expect(tried.status).toBe(401);
    expect(tried.text).toContain("That passphrase is not right.");
    await sql.query("DELETE FROM owner_setup WHERE id = 1");
    await sqlInsert(sql, malformed);
    const again = await https(app, "GET", "/signin");
    const bad = await https(app, "POST", "/signin", {
      cookie: cookieOf(again),
      body: new URLSearchParams({ csrf: csrfOf(again.text), passphrase: phrase }).toString(),
    });
    expect(bad.status).toBe(401);
    const logged = lines.join("\n");
    expect(logged).toContain("sign-in passphrase hash is not usable");
    expect(logged).not.toContain(phrase);
    expect(logged).not.toContain(legacy);
    expect(logged).not.toContain(malformed);
  });

  it("rate limits a wrong secret without locking sign-in, and a later right secret stays blocked", async () => {
    const { app, sql } = await boot();
    const page = await form(app);
    let csrf = page.csrf;
    for (let i = 0; i < 5; i += 1) {
      const refused = await https(app, "POST", "/setup", {
        cookie: page.cookie,
        body: claimBody(csrf, WRONG, PASS),
      });
      expect(refused.status).toBe(401);
      expect(refused.text).toContain("That setup secret is not right.");
      expect(refused.text).not.toContain(WRONG);
      csrf = csrfOf(refused.text);
    }
    const blocked = await https(app, "POST", "/setup", {
      cookie: page.cookie,
      body: claimBody(csrf, SECRET, PASS),
    });
    expect(blocked.status).toBe(429);
    expect(await ownerRow(sql)).toBeUndefined();
    const buckets = await sql.query<{ bucket: string }>("SELECT bucket FROM passphrase_failures ORDER BY bucket");
    expect(buckets.rows.map((row) => row.bucket).every((bucket) => bucket.startsWith("setup:"))).toBe(true);

    const sign = await https(app, "GET", "/signin");
    const tried = await https(app, "POST", "/signin", {
      cookie: cookieOf(sign),
      body: new URLSearchParams({ csrf: csrfOf(sign.text), passphrase: PASS }).toString(),
    });
    expect(tried.status).toBe(401);
    expect(tried.text).toContain("That passphrase is not right.");
  });

  it("is 404 when a passphrase or CBM_SECRET is missing, and cron copy hides when cron is set", async () => {
    const withPass = await boot({ OWNER_PASSPHRASE: "env-passphrase-wins-here" });
    const closed = await https(withPass.app, "GET", "/setup");
    expect(closed.status).toBe(404);
    expect(closed.text).toContain("already has an owner");
    await sqlInsert(withPass.sql, sha256("stored-passphrase-should-lose"));
    const sign = await https(withPass.app, "GET", "/signin");
    const storedTry = await https(withPass.app, "POST", "/signin", {
      cookie: cookieOf(sign),
      body: new URLSearchParams({ csrf: csrfOf(sign.text), passphrase: "stored-passphrase-should-lose" }).toString(),
    });
    expect(storedTry.status).toBe(401);
    const envTry = await https(withPass.app, "POST", "/signin", {
      cookie: cookieOf(sign),
      body: new URLSearchParams({ csrf: csrfOf(storedTry.text), passphrase: "env-passphrase-wins-here" }).toString(),
    });
    expect(envTry.status).toBe(200);
    expect(envTry.text).toContain("Signed in");

    const bare = await boot({
      CBM_SECRET: undefined,
      OWNER_TOKEN: "owner-token-at-least-32-characters",
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    const missing = await https(bare.app, "GET", "/setup");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("Set CBM_SECRET");

    const cron = await boot({ CRON_SECRET: "cron-secret-for-setup-page" });
    const page = await form(cron.app);
    expect(page.text).not.toContain("Overnight checks are off");
    expect((await https(cron.app, "PUT", "/setup")).status).toBe(405);
  });

  it("lets one of two racing claims win, and the next boot uses the stored zone", async () => {
    const values = env();
    const sql = await openSql(loadConfig(values));
    open.push(sql);
    let arrived = 0;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const first = await createServer(values, {
      sql,
      passphraseCost: FAST,
      beforeSetupClaim: () => {
        arrived += 1;
        if (arrived >= 2) openGate();
        return gate;
      },
    });
    open.push(first);
    const page = await form(first);
    const [left, right] = await Promise.all([
      https(first, "POST", "/setup", { cookie: page.cookie, body: claimBody(page.csrf, SECRET, PASS, "America/Chicago") }),
      https(first, "POST", "/setup", { cookie: page.cookie, body: claimBody(page.csrf, SECRET, OTHER, "America/Chicago") }),
    ]);
    expect(arrived).toBe(2);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses).toEqual([302, 409]);
    const winner = left.status === 302 ? left : right;
    const winnerPass = left.status === 302 ? PASS : OTHER;
    expect(locationOf(winner)).toBe("/connect");
    expect((left.status === 409 ? left : right).text).toContain("Someone else finished setup");
    const row = await ownerRow(sql);
    expect(row?.passphrase_hash.startsWith("scrypt$14$8$1$")).toBe(true);
    const again = await https(first, "GET", "/signin");
    const winnerSign = await https(first, "POST", "/signin", {
      cookie: cookieOf(again),
      body: new URLSearchParams({ csrf: csrfOf(again.text), passphrase: winnerPass }).toString(),
    });
    expect(winnerSign.status).toBe(200);
    const loserPass = winnerPass === PASS ? OTHER : PASS;
    const loserPage = await https(first, "GET", "/signin");
    const loserSign = await https(first, "POST", "/signin", {
      cookie: cookieOf(loserPage),
      body: new URLSearchParams({ csrf: csrfOf(loserPage.text), passphrase: loserPass }).toString(),
    });
    expect(loserSign.status).toBe(401);
    const count = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM owner_setup");
    expect(Number(count.rows[0]?.n)).toBe(1);
    const home = await https(first, "GET", "/signin", { cookie: cookieOf(winner) });
    expect(home.text).toContain("Signed in");
    const old = await https(first, "GET", "/signin", { cookie: page.cookie });
    expect(old.text).not.toContain("<h1>Signed in</h1>");

    await first.close();
    const second = await createServer(values, { sql });
    open.push(second);
    expect(second.config.ownerTimezone).toBe("America/Chicago");
    expect(second.config.ownerTimezoneDefaulted).toBe(false);
    expect((await https(second, "GET", "/setup")).status).toBe(404);
  });
});

async function sqlInsert(sql: Sql, hash: string): Promise<void> {
  await sql.query(
    "INSERT INTO owner_setup (id, passphrase_hash, timezone, claimed_at) VALUES (1, $1, NULL, $2)",
    [hash, "2026-11-06T00:00:00.000Z"],
  );
}
