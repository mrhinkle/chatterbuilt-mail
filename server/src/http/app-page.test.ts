import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { FakeProvider } from "../providers/fake.js";
import { FakeGmailServer, type HttpFault } from "../providers/gmail-fake-server.js";
import { openSql } from "../store/sql.js";
import { createServer, type Running } from "./app.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const PASSPHRASE = "correct-horse-battery-staple";
const MODEL_KEY = "sk-ant-test-key-do-not-log-9f3c";
const DRAFT_BODY = "ZEBRA-DRAFT-BODY-9f3c";
const CLIENT_SECRET = "client-secret-DO-NOT-LOG-zz";
const ACCESS = "access-DO-NOT-LOG-zz";
const REFRESH = "refresh-DO-NOT-LOG-zz";

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

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    OWNER_TOKEN: TOKEN,
    OWNER_PASSPHRASE: PASSPHRASE,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
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

function tokenOf(cookie: string): string {
  return cookie.slice("cbm_owner=".length);
}

function csrfOf(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error("csrf missing");
  return match[1];
}

function pageCsrf(html: string): string {
  const match = /window\.__cbm=(\{.*?\});/.exec(html);
  if (!match?.[1]) throw new Error("boot missing");
  const boot = JSON.parse(match[1]) as { csrf?: string; sample?: boolean };
  if (!boot.csrf) throw new Error("page csrf missing");
  return boot.csrf;
}

function json(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function https(
  app: Running,
  method: string,
  path: string,
  options: { cookie?: string; body?: string; type?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.type) headers["content-type"] = options.type;
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
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (options.body !== undefined) req.end(payload);
    else req.end();
  });
}

async function boot(
  extra: Record<string, string | undefined> = {},
  logs?: string[],
): Promise<Running> {
  const app = await createServer(env(extra), logs ? { logSink: (line) => logs.push(line) } : {});
  open.push(app);
  return app;
}

function drafts(app: Running): number {
  if (!(app.provider instanceof FakeProvider)) throw new Error("expected the fake mailbox");
  return app.provider.counts.createDraft;
}

async function signIn(app: Running): Promise<{ cookie: string; csrf: string; html: string }> {
  const start = await https(app, "GET", "/signin?next=/app");
  expect(start.status, start.text).toBe(200);
  expect(start.text).toContain('name="next" value="/app"');
  const first = cookieOf(start);
  const posted = await https(app, "POST", "/signin", {
    cookie: first,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE, next: "/app" }).toString(),
  });
  expect(posted.status, posted.text).toBe(302);
  expect(locationOf(posted)).toBe("/app");
  const cookie = cookieOf(posted) || first;
  const page = await https(app, "GET", "/app", { cookie });
  expect(page.status, page.text.slice(0, 180)).toBe(200);
  return { cookie, csrf: pageCsrf(page.text), html: page.text };
}

function postCall(app: Running, cookie: string, csrf: string | undefined, body: unknown): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (csrf !== undefined) headers["x-cbm-csrf"] = csrf;
  return https(app, "POST", "/app/api/call", {
    cookie,
    type: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

const draftInput = {
  server: "Chatterbuilt Mail",
  tool: "create_draft",
  input: { account: "gmail_work", to: "lee@makerspace.example", subject: "Hello", body: DRAFT_BODY },
};

function noCors(res: Answer): void {
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
}

function headerOne(res: Answer, name: string): string {
  const value = res.headers[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function scriptNonce(res: Answer): string {
  const match = /script-src 'nonce-([^']+)'/.exec(headerOne(res, "content-security-policy"));
  if (!match?.[1]) throw new Error(`script nonce missing: ${headerOne(res, "content-security-policy")}`);
  return match[1];
}

function scriptSrcOf(res: Answer): string {
  const part = headerOne(res, "content-security-policy")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("script-src "));
  return part ?? "";
}

function listen(hits: { n: number; models: string[] }): Promise<string> {
  const server = createHttpServer((req, res) => {
    hits.n += 1;
    res.setHeader("content-type", "application/json");
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string };
        if (typeof body.model === "string") hits.models.push(body.model);
      } catch {
        hits.models.push("");
      }
      res.end(JSON.stringify({ content: [{ type: "text", text: "Sponsorship talks are moving." }] }));
    });
  });
  open.push({
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("/app", () => {
  it("redirects /app and refuses the API when nobody is signed in", async () => {
    const app = await boot();
    const page = await https(app, "GET", "/app");
    expect(page.status).toBe(302);
    expect(locationOf(page)).toBe("/signin?next=/app");
    expect(page.text).not.toContain("window.claude");
    expect(page.text).not.toContain("const CONFIG");
    const manifest = await https(app, "GET", "/app/manifest.webmanifest");
    expect(manifest.status).toBe(302);
    expect(locationOf(manifest)).toBe("/signin?next=/app");
    const icon = await https(app, "GET", "/app/icon.svg");
    expect(icon.status).toBe(302);
    const call = await postCall(app, "", undefined, draftInput);
    const sample = await https(app, "POST", "/app/api/sample", {
      type: "application/json",
      body: JSON.stringify({ prompt: "hi" }),
    });
    const getCall = await https(app, "GET", "/app/api/call");
    expect(call.status).toBe(401);
    expect(json(call.text).code).toBe("unauthorized");
    expect(sample.status).toBe(401);
    expect(getCall.status).toBe(401);
    noCors(call);
    noCors(sample);
    expect(drafts(app)).toBe(0);
  });

  it("does not follow a next value other than /app", async () => {
    const app = await boot();
    const evil = await https(app, "GET", "/signin?next=https://evil.example/app");
    expect(evil.status).toBe(200);
    expect(evil.text).not.toContain("evil.example");
    expect(evil.text).not.toContain('name="next"');
  });

  it("serves the built page after sign-in and runs nothing without the CSRF header", async () => {
    const logs: string[] = [];
    const app = await boot({}, logs);
    const owner = await signIn(app);
    expect(owner.html).toContain("window.__cbmStandalone=true");
    expect(owner.html).toContain("window.claude=");
    expect(owner.html.indexOf("window.__cbmStandalone=true")).toBeLessThan(owner.html.indexOf("const CONFIG = {"));
    expect(owner.html).toContain("alex@riveralabs.example");
    expect(owner.html).toContain("alex.rivera@mail.example");
    expect(owner.html).not.toContain("[] /* CBM_ACCOUNTS */");
    const injected = /accounts: (\[[\s\S]*?\]) \/\* CBM_ACCOUNTS \*\//.exec(owner.html);
    expect(injected?.[1]).toBeTruthy();
    const rows = JSON.parse(injected?.[1] ?? "[]") as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["capabilities", "color", "email", "id", "kind", "label"]);
      expect(row.kind).toBe("gmail");
      expect(row.capabilities).toEqual({ filters: true, sendAs: true, labels: "labels" });
    }
    expect(owner.html).toContain('name="theme-color" content="#2563eb"');
    expect(owner.html).toContain('rel="manifest" href="/app/manifest.webmanifest"');
    expect(owner.html).toContain('"sample":false');
    const csp = String(owner.html && owner.cookie && (await https(app, "GET", "/app", { cookie: owner.cookie })).headers["content-security-policy"]);
    expect(csp).toContain("https://cdnjs.cloudflare.com");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
    const headers = (await https(app, "GET", "/app", { cookie: owner.cookie })).headers;
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(String(headers["cache-control"])).toContain("no-store");
    const manifest = await https(app, "GET", "/app/manifest.webmanifest", { cookie: owner.cookie });
    expect(manifest.status).toBe(200);
    expect(json(manifest.text).start_url).toBe("/app");
    expect(json(manifest.text).display).toBe("standalone");
    const icon = await https(app, "GET", "/app/icon.svg", { cookie: owner.cookie });
    expect(icon.status).toBe(200);
    expect(icon.headers["content-type"]).toContain("image/svg+xml");
    expect(icon.text).toContain("Chatterbuilt Mail");
    expect(icon.text).toContain("#6c4cf1");

    const before = drafts(app);
    const missing = await postCall(app, owner.cookie, undefined, draftInput);
    const wrong = await postCall(app, owner.cookie, "not-the-session-csrf", draftInput);
    const options = await https(app, "OPTIONS", "/app/api/call", { cookie: owner.cookie });
    expect(missing.status).toBe(403);
    expect(json(missing.text).message).toBe("This page has expired. Reload it.");
    expect(wrong.status).toBe(403);
    expect(options.status).toBe(204);
    noCors(missing);
    noCors(wrong);
    noCors(options);
    expect(String(missing.headers["cache-control"])).toContain("no-store");
    expect(drafts(app)).toBe(before);

    const other = await postCall(app, owner.cookie, owner.csrf, { server: "Notion", tool: "search", input: {} });
    expect(other.status).toBe(400);
    expect(json(other.text).code).toBe("server_not_connected");
    expect(String(json(other.text).message)).toContain("isn't available outside Claude");
    expect(drafts(app)).toBe(before);

    const listed = await postCall(app, owner.cookie, owner.csrf, { tool: "list_accounts", input: {} });
    expect(listed.status).toBe(200);
    const payload = json(listed.text).payload as {
      accounts?: Array<{ email?: string; kind?: string; capabilities?: { filters: boolean; sendAs: boolean; labels: string } }>;
    };
    expect(payload.accounts?.map((account) => account.email)).toEqual(expect.arrayContaining([
      "alex@riveralabs.example",
      "alex.rivera@mail.example",
    ]));
    for (const account of payload.accounts ?? []) {
      expect(account.kind).toBe("gmail");
      expect(account.capabilities).toEqual({ filters: true, sendAs: true, labels: "labels" });
    }
    expect(drafts(app)).toBe(before);

    const saved = await postCall(app, owner.cookie, owner.csrf, draftInput);
    expect(saved.status).toBe(200);
    expect(json(saved.text).payload).toMatchObject({ id: expect.any(String) });
    expect(drafts(app)).toBe(before + 1);

    const quiet = await https(app, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "Summarize the gold package thread." }),
    });
    expect(quiet.status).toBe(200);
    expect(json(quiet.text)).toEqual({ text: null });

    const blob = logs.join("\n");
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain(PASSPHRASE);
    expect(blob).not.toContain(owner.csrf);
    expect(blob).not.toContain(tokenOf(owner.cookie));
    expect(blob).not.toContain(DRAFT_BODY);
    expect(blob).not.toContain("Can we lock the gold package");
  });

  it("sends a fresh script nonce and one charset meta", async () => {
    const app = await boot();
    const owner = await signIn(app);
    const first = await https(app, "GET", "/app", { cookie: owner.cookie });
    const second = await https(app, "GET", "/app", { cookie: owner.cookie });
    const nonceA = scriptNonce(first);
    const nonceB = scriptNonce(second);
    expect(nonceA).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(nonceB).not.toBe(nonceA);
    expect(scriptSrcOf(first)).toBe(`script-src 'nonce-${nonceA}' https://cdnjs.cloudflare.com`);
    expect(scriptSrcOf(first)).not.toContain("unsafe-inline");
    expect(headerOne(first, "content-security-policy")).toContain("style-src 'unsafe-inline' https://fonts.googleapis.com");
    const tags = [...first.text.matchAll(/<script\b([^>]*)>/g)];
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag[1]).toContain(`nonce="${nonceA}"`);
    expect(second.text.match(new RegExp(`<script\\b[^>]*nonce="${nonceB}"`, "g"))).toHaveLength(2);
    expect(first.text.match(/<meta charset="utf-8">/g)).toHaveLength(1);
    expect(second.text.match(/<meta charset="utf-8">/g)).toHaveLength(1);
  });

  it("calls the local model once and does not send an oversized prompt", async () => {
    const hits = { n: 0, models: [] as string[] };
    const base = await listen(hits);
    const logs: string[] = [];
    const app = await boot({ ANTHROPIC_API_KEY: MODEL_KEY, ANTHROPIC_API_BASE: base }, logs);
    const owner = await signIn(app);
    expect(owner.html).toContain('"sample":true');
    const tooBig = await https(app, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "x".repeat(24_001) }),
    });
    expect(tooBig.status).toBe(413);
    expect(hits.n).toBe(0);
    const answered = await https(app, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "PROMPT-MARKER-do-not-log Can we lock the gold package" }),
    });
    expect(answered.status).toBe(200);
    expect(json(answered.text).text).toBe("Sponsorship talks are moving.");
    expect(hits.n).toBe(1);
    for (let i = 0; i < 29; i += 1) {
      const again = await https(app, "POST", "/app/api/sample", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body: JSON.stringify({ prompt: "again" }),
      });
      expect(again.status).toBe(200);
    }
    const limited = await https(app, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "over the limit" }),
    });
    expect(limited.status).toBe(429);
    expect(json(limited.text).code).toBe("rate_limited");
    expect(hits.n).toBe(30);
    expect(hits.models).toEqual(Array.from({ length: 30 }, () => "claude-haiku-5-5"));
    const blob = logs.join("\n");
    expect(blob).not.toContain(MODEL_KEY);
    expect(blob).not.toContain("PROMPT-MARKER-do-not-log");
    expect(blob).not.toContain("Can we lock the gold package");
    expect(blob).toContain("anthropic");
  });

  it("keeps the sample limit across two servers that share the store", async () => {
    const hits = { n: 0, models: [] as string[] };
    const base = await listen(hits);
    const settings = env({ ANTHROPIC_API_KEY: MODEL_KEY, ANTHROPIC_API_BASE: base });
    const sql = await openSql(loadConfig(settings));
    open.push({ close: () => sql.close() });
    const first = await createServer(settings, { sql });
    const second = await createServer(settings, { sql });
    open.push(first, second);
    const owner = await signIn(first);
    const servers = [first, second];
    for (let i = 0; i < 30; i += 1) {
      const res = await https(servers[i % 2]!, "POST", "/app/api/sample", {
        cookie: owner.cookie,
        type: "application/json",
        headers: { "x-cbm-csrf": owner.csrf },
        body: JSON.stringify({ prompt: "again" }),
      });
      expect(res.status, String(i)).toBe(200);
    }
    const limited = await https(second, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "over the limit" }),
    });
    expect(limited.status).toBe(429);
    expect(json(limited.text).code).toBe("rate_limited");
    const still = await https(first, "POST", "/app/api/sample", {
      cookie: owner.cookie,
      type: "application/json",
      headers: { "x-cbm-csrf": owner.csrf },
      body: JSON.stringify({ prompt: "still over" }),
    });
    expect(still.status).toBe(429);
    expect(hits.n).toBe(30);
  });

  it("does not retry a write that the mailbox rejects", async () => {
    const faults: HttpFault[] = [
      { kind: "status", status: 500 },
      { kind: "status", status: 429 },
      { kind: "drop" },
    ];
    for (const fault of faults) {
      const gmail = await FakeGmailServer.demo();
      open.push(gmail);
      const logs: string[] = [];
      const key = randomBytes(32);
      const app = await createServer({
        OWNER_TOKEN: TOKEN,
        OWNER_PASSPHRASE: PASSPHRASE,
        ENCRYPTION_KEY: key.toString("base64"),
        MAIL_MODE: "direct",
        MAIL_STORE: "pglite",
        MAIL_PROVIDER: "gmail",
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "0",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        OWNER_TIMEZONE: "UTC",
        GMAIL_API_BASE: gmail.apiBase,
        GOOGLE_TOKEN_URL: gmail.tokenUrl,
      }, { logSink: (line) => logs.push(line) });
      open.push(app);
      await app.store.upsertAccount({
        id: "gmail_work",
        email: "alex@riveralabs.example",
        label: "Rivera Labs",
        kind: "gmail",
        color: "blue",
      }, 0);
      await app.store.upsertToken("gmail_work", app.config.encryptionKey, JSON.stringify({
        refreshToken: REFRESH,
        accessToken: ACCESS,
        expiresAt: Date.now() + 3_600_000,
      }));
      const owner = await signIn(app);
      gmail.failNextWrite(fault);
      const marked = gmail.recordedWrites().length;
      const failed = await postCall(app, owner.cookie, owner.csrf, draftInput);
      expect(failed.status).toBeGreaterThanOrEqual(400);
      const body = json(failed.text);
      if (fault.kind === "status" && fault.status === 429) expect(body.code).toBe("rate_limited");
      else expect(body.code).toBe("upstream_error");
      expect(body.retryable).not.toBe(true);
      expect(gmail.recordedWrites().length - marked).toBe(1);
      const blob = logs.join("\n");
      expect(blob).not.toContain(DRAFT_BODY);
      expect(blob).not.toContain(ACCESS);
      expect(blob).not.toContain(REFRESH);
      expect(blob).not.toContain(CLIENT_SECRET);
      expect(blob).not.toContain(PASSPHRASE);
      expect(blob).not.toContain(TOKEN);
    }
  }, 120_000);
});
