import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpsRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { connectHubPage, setupPage, type OtherMailForm } from "../auth/pages.js";
import { loadConfig } from "../config.js";
import { openSql, type Sql } from "../store/sql.js";
import { createServer, type Running } from "./app.js";

/** The same string stands in for an account email, its display name, and its label. */
const ATTACK = '"><img src=x onerror=alert(1)>';
const ESCAPED = "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;";
const PASSPHRASE = randomBytes(18).toString("hex");
const TOKEN = randomBytes(18).toString("hex");
const SECRET = randomBytes(18).toString("hex");

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const open: Array<{ close: () => Promise<void> }> = [];

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-app.mjs"], { cwd: serverDir, stdio: "pipe" });
});

afterEach(async () => {
  while (open.length > 0) {
    const item = open.pop();
    if (item) await item.close();
  }
});

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
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

function env(extra: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "fake",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ...extra,
  };
}

async function boot(extra: Record<string, string | undefined>): Promise<{ app: Running; sql: Sql }> {
  const values = env(extra);
  const sql = await openSql(loadConfig(values));
  open.push(sql);
  const app = await createServer(values, { sql });
  open.push(app);
  return { app, sql };
}

function assertEscaped(html: string): void {
  expect(html).toContain(ESCAPED);
  expect(html).not.toContain("<img");
  expect(html).not.toContain(ATTACK);
}

describe("XSS render", () => {
  it("escapes /setup and does not echo the passphrase", async () => {
    assertEscaped(setupPage(ATTACK, ATTACK, ATTACK));
    const { app } = await boot({ CBM_SECRET: SECRET });
    const page = await https(app, "GET", "/setup");
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<img");
    expect(page.text).not.toContain(ATTACK);
    const wrongSecret = randomBytes(18).toString("hex");
    const wrongPass = randomBytes(18).toString("hex");
    const posted = await https(app, "POST", "/setup", {
      cookie: cookieOf(page),
      body: new URLSearchParams({ csrf: csrfOf(page.text), secret: wrongSecret, passphrase: wrongPass, timezone: ATTACK }).toString(),
    });
    expect(posted.status).toBe(401);
    expect(posted.text).toContain("That setup secret is not right.");
    expect(posted.text).not.toContain("<img");
    expect(posted.text).not.toContain(ATTACK);
    expect(posted.text).not.toContain(wrongSecret);
    expect(posted.text).not.toContain(wrongPass);
  });

  it("escapes /connect and the account email and label on /app", async () => {
    const other: OtherMailForm = {
      email: ATTACK,
      host: ATTACK,
      port: "",
      security: "",
      user: ATTACK,
      smtpHost: "",
      smtpPort: "",
      helpUrl: "",
      helpLabel: ATTACK,
      note: ATTACK,
      discoveredHost: "",
      discoveredSmtp: "",
      serverKeepsSent: false,
    };
    assertEscaped(connectHubPage({
      csrf: ATTACK,
      origin: "https://mail.example.test",
      googleReady: false,
      googleSaved: false,
      microsoftReady: false,
      microsoftDevice: false,
      microsoftSaved: false,
      error: ATTACK,
      nonce: "n",
      other,
    }));

    const { app } = await boot({ OWNER_TOKEN: TOKEN, OWNER_PASSPHRASE: PASSPHRASE });
    const start = await https(app, "GET", "/signin");
    const signed = await https(app, "POST", "/signin", {
      cookie: cookieOf(start),
      body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE }).toString(),
    });
    const cookie = cookieOf(signed) || cookieOf(start);
    const hub = await https(app, "GET", "/connect", { cookie });
    expect(hub.status).toBe(200);
    const echoed = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(hub.text),
        action: "find",
        email: ATTACK,
        user: ATTACK,
        host: ATTACK,
      }).toString(),
    });
    expect(echoed.status).toBe(400);
    assertEscaped(echoed.text);

    await app.store.upsertAccount({ id: "xss_box", email: ATTACK, label: ATTACK, kind: "gmail" }, 50);
    const mail = await https(app, "GET", "/app", { cookie });
    expect(mail.status).toBe(200);
    const injected = /accounts: (\[[\s\S]*?\]) \/\* CBM_ACCOUNTS \*\//.exec(mail.text);
    expect(injected?.[1]).toBeTruthy();
    const source = injected?.[1] ?? "";
    expect(source).toContain("\\u003cimg");
    expect(source).not.toContain("<img");
    const rows = JSON.parse(source) as Array<{ id?: string; email?: string; label?: string }>;
    const row = rows.find((item) => item.id === "xss_box");
    expect(row?.email).toBe(ATTACK);
    expect(row?.label).toBe(ATTACK);
  });
});
