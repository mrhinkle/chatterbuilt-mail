import { randomBytes } from "node:crypto";
import { request as httpsRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoverDeps } from "../auth/discover.js";
import { openSeal } from "../crypto/seal.js";
import { loadConfig } from "../config.js";
import { GmailProvider } from "../providers/gmail.js";
import type { ImapHooks } from "../providers/imap-hooks.js";
import type { ImapSession } from "../providers/imap-session.js";
import { MicrosoftProvider } from "../providers/microsoft.js";
import { ProviderRouter } from "../providers/router.js";
import { openSql, type Sql } from "../store/sql.js";
import { createServer, type Running } from "./app.js";

const PASSPHRASE = "correct-horse-battery-staple";
const TOKEN = "test-owner-token-do-not-log-0123456789";
const GOOGLE_SECRET = "google-secret-do-not-log";
const GOOGLE_ID = "123456789012-abcxyz.apps.googleusercontent.com";
const MICROSOFT_SECRET = "microsoft-secret-do-not-log";
const MICROSOFT_ID = "11111111-2222-4333-8444-555555555555";

const open: Array<{ close: () => Promise<void> }> = [];

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
  hooks?: { imap?: ImapHooks; discover?: DiscoverDeps },
): Promise<{ app: Running; sql: Sql }> {
  const values = env(extra);
  const sql = await openSql(loadConfig(values));
  open.push(sql);
  const app = await createServer(values, { sql, logSink, imap: hooks?.imap, discover: hooks?.discover });
  open.push(app);
  return { app, sql };
}

async function signIn(app: Running): Promise<string> {
  const page = await https(app, "GET", "/signin");
  expect(page.status).toBe(200);
  const cookie = cookieOf(page);
  const posted = await https(app, "POST", "/signin", {
    cookie,
    body: new URLSearchParams({ csrf: csrfOf(page.text), passphrase: PASSPHRASE }).toString(),
  });
  expect(posted.status, posted.text).toBe(200);
  return cookieOf(posted) || cookie;
}

async function clientCount(sql: Sql): Promise<number> {
  const result = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM provider_clients");
  return Number(result.rows[0]?.n ?? 0);
}

function router(app: Running): ProviderRouter {
  if (!(app.provider instanceof ProviderRouter)) throw new Error("expected ProviderRouter");
  return app.provider;
}

function jsonPost(app: Running, body: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${app.url}/mcp`);
    const payload = Buffer.from(body);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: "/mcp",
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${TOKEN}`,
        "content-length": String(payload.length),
      },
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
    req.end(payload);
  });
}

function toolData(raw: string): Record<string, unknown> {
  let payload = raw;
  if (raw.startsWith("event:") || raw.startsWith("data:") || raw.includes("\ndata:")) {
    payload = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1) ?? "";
  }
  const json = JSON.parse(payload) as { result?: { content?: { text?: string }[] } };
  return JSON.parse(json.result?.content?.[0]?.text ?? "") as Record<string, unknown>;
}

describe("/connect", () => {
  it("requires an owner session and shows the three cards", async () => {
    const { app } = await boot();
    const bare = await https(app, "GET", "/connect");
    expect(bare.status).toBe(401);
    expect(bare.text).toContain("Sign in first");
    expect(bare.text).not.toContain("Save Google client");

    const unsigned = await https(app, "GET", "/signin");
    const waiting = await https(app, "GET", "/connect", { cookie: cookieOf(unsigned) });
    expect(waiting.status).toBe(401);

    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.status).toBe(200);
    const nonce = /script-src 'nonce-([^']+)'/.exec(String(page.headers["content-security-policy"] ?? ""))?.[1];
    expect(nonce).toBeTruthy();
    expect(page.text).toContain(`nonce="${nonce}"`);
    expect(page.text).toContain("Connect your mail");
    expect(page.text).toContain("Google");
    expect(page.text).toContain("Microsoft");
    expect(page.text).toContain("Other email");
    expect(page.text).toContain(`${app.url}/connect/google/callback`);
    expect(page.text).toContain(`${app.url}/connect/microsoft/callback`);
    expect(page.text).toContain("Save Google client");
    expect(page.text).toContain("Save Microsoft client");
    expect(page.text).toContain('id="ms-own-client-id"');
    expect(page.text).toContain('id="ms-own-client-secret"');
    expect(page.text.match(/id="ms-client-id"/g)).toEqual(['id="ms-client-id"']);
    expect(page.text).not.toContain(GOOGLE_SECRET);

    const alias = await https(app, "GET", "/api/connect", { cookie });
    expect(alias.status).toBe(200);
    expect(alias.text).toContain("Connect your mail");

    expect((await https(app, "POST", "/connect", { cookie, body: "csrf=no" })).status).toBe(405);
  });

  it("refuses a client save without the session or the matching token", async () => {
    const { app, sql } = await boot();
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    const body = new URLSearchParams({
      csrf: csrfOf(page.text),
      client_id: "not-a-google-client",
      client_secret: GOOGLE_SECRET,
    }).toString();
    const denied = await https(app, "POST", "/connect/google/client", { body });
    expect(denied.status).toBe(401);
    const expired = await https(app, "POST", "/connect/google/client", {
      cookie,
      body: new URLSearchParams({ csrf: "not-the-token", client_id: "123-abc.apps.googleusercontent.com", client_secret: GOOGLE_SECRET }).toString(),
    });
    expect(expired.status).toBe(400);
    expect(expired.text).toContain("This form has expired.");
    expect(expired.text).not.toContain(GOOGLE_SECRET);
    expect((await https(app, "PUT", "/connect/microsoft/client")).status).toBe(405);
    const bad = await https(app, "POST", "/connect/google/client", { cookie, body });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("not valid");
    expect(bad.text).not.toContain(GOOGLE_SECRET);
    expect(await clientCount(sql)).toBe(0);
    const microsoft = await https(app, "POST", "/connect/microsoft/client", {
      cookie,
      body: new URLSearchParams({ csrf: csrfOf(bad.text), client_id: "app", client_secret: MICROSOFT_SECRET }).toString(),
    });
    expect(microsoft.status).toBe(400);
    expect(microsoft.text).not.toContain(MICROSOFT_SECRET);
    expect(await clientCount(sql)).toBe(0);
  });

  it("shows sign-in when the host already has a client, and hides the secret", async () => {
    const { app, sql } = await boot({
      GOOGLE_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
      MICROSOFT_CLIENT_ID: MICROSOFT_ID,
      MICROSOFT_CLIENT_SECRET: MICROSOFT_SECRET,
    });
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.status).toBe(200);
    expect(page.text).toContain("Sign in with Google");
    expect(page.text).toContain("This host already has a Google client.");
    expect(page.text).toContain("Sign in with Microsoft");
    expect(page.text).toContain("This host already has a Microsoft client.");
    expect(page.text).toContain("This sends you to Microsoft and back here.");
    expect(page.text).not.toContain("Save Google client");
    expect(page.text).not.toContain("Save Microsoft client");
    expect(page.text).not.toContain('id="ms-client-id"');
    expect(page.text).not.toContain('id="ms-own-client-id"');
    expect(page.text).not.toContain(GOOGLE_SECRET);
    expect(page.text).not.toContain(MICROSOFT_SECRET);
    const kept = await https(app, "POST", "/connect/google/client", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(page.text),
        client_id: "999-other.apps.googleusercontent.com",
        client_secret: "another-secret-value",
      }).toString(),
    });
    expect(kept.status).toBe(409);
    expect(kept.text).toContain("already has a Google client");
    expect(kept.text).not.toContain("another-secret-value");
    expect(app.config.googleClientId).toBe("1234567890-abc.apps.googleusercontent.com");
    expect(await clientCount(sql)).toBe(0);
  });

  it("saves a Google client sealed and starts sign-in with it, without a restart", async () => {
    const lines: string[] = [];
    const key = randomBytes(32).toString("base64");
    const { app, sql } = await boot({ ENCRYPTION_KEY: key, MAIL_PROVIDER: "live" }, (line) => lines.push(line));
    expect(router(app).providerFor({ kind: "gmail" })).toBeUndefined();
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.text).toContain("First, give your server its own Google sign-in");
    expect(page.text).toContain("https://console.developers.google.com/auth/clients");
    expect(page.text).toContain("https://console.developers.google.com/auth/branding");
    expect(page.text).toContain("https://console.developers.google.com/auth/scopes");
    expect(page.text).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(page.text).toContain("https://www.googleapis.com/auth/gmail.settings.basic");
    expect(page.text).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(page.text).toContain("External");
    expect(page.text).toContain("In production");
    expect(page.text).toContain("7 days");
    expect(page.text).toContain("Trusted");
    expect(page.text).toContain('data-copy="google-redirect"');

    const saved = await https(app, "POST", "/connect/google/client", {
      cookie,
      body: new URLSearchParams({ csrf: csrfOf(page.text), client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET }).toString(),
    });
    expect(saved.status).toBe(302);
    expect(locationOf(saved)).toBe("/connect");
    expect(saved.text).not.toContain(GOOGLE_SECRET);
    const row = (await sql.query<{ client_id: string; secret_sealed: string | null }>(
      "SELECT client_id, secret_sealed FROM provider_clients WHERE provider = 'google'",
    )).rows[0];
    expect(row?.client_id).toBe(GOOGLE_ID);
    expect(row?.secret_sealed).toBeTruthy();
    expect(row?.secret_sealed).not.toBe(GOOGLE_SECRET);
    expect(openSeal(app.config.encryptionKey, row?.secret_sealed ?? "")).toBe(GOOGLE_SECRET);
    expect(app.config.googleClientFromEnv).toBe(false);
    expect(router(app).providerFor({ kind: "gmail" })).toBeInstanceOf(GmailProvider);

    const hub = await https(app, "GET", "/connect", { cookie });
    expect(hub.text).toContain("Sign in with Google");
    expect(hub.text).toContain("A Google client is saved on this server.");
    expect(hub.text).not.toContain(GOOGLE_SECRET);
    expect(hub.text).not.toContain("Save Google client");
    const started = await https(app, "GET", "/connect/google", { cookie });
    expect(started.status).toBe(302);
    const authUrl = new URL(locationOf(started));
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("client_id")).toBe(GOOGLE_ID);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(`${app.url}/connect/google/callback`);
    expect(started.text).not.toContain(GOOGLE_SECRET);

    const listed = await jsonPost(app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} },
    }));
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(GOOGLE_SECRET);
    expect(lines.join("\n")).not.toContain(GOOGLE_SECRET);
    expect(lines.join("\n")).toContain("google client saved");
    const info = await jsonPost(app, JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    }));
    expect(info.status).toBe(200);
    expect(toolData(info.text)).toMatchObject({
      providers: { google: true, imap: true },
    });
    expect(info.text).not.toContain(GOOGLE_SECRET);

    const againLines: string[] = [];
    const again = await createServer(env({ ENCRYPTION_KEY: key, MAIL_PROVIDER: "live" }), {
      sql,
      logSink: (line) => againLines.push(line),
    });
    open.push(again);
    expect(again.config.googleClientId).toBe(GOOGLE_ID);
    expect(again.config.googleClientSecret).toBe(GOOGLE_SECRET);
    expect(again.config.googleClientFromEnv).toBe(false);
    expect(router(again).providerFor({ kind: "gmail" })).toBeInstanceOf(GmailProvider);
    const next = await https(again, "GET", "/connect", { cookie });
    expect(next.status).toBe(200);
    expect(next.text).toContain("A Google client is saved on this server.");
    expect(next.text).not.toContain(GOOGLE_SECRET);
    expect(againLines.join("\n")).not.toContain(GOOGLE_SECRET);
  });

  it("says a Microsoft client with no secret asks for a code", async () => {
    const { app } = await boot({ MICROSOFT_CLIENT_ID: MICROSOFT_ID });
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.text).toContain("Sign in with Microsoft");
    expect(page.text).toContain("This asks you to type a code at Microsoft.");
    expect(page.text).toContain("This host already has a Microsoft client.");
    expect(page.text).not.toContain("Save Microsoft client");
  });

  it("saves a Microsoft client with no secret as a code you type, and a secret as a redirect", async () => {
    const lines: string[] = [];
    const key = randomBytes(32).toString("base64");
    const { app, sql } = await boot({ ENCRYPTION_KEY: key, MAIL_PROVIDER: "live" }, (line) => lines.push(line));
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.text).toContain("https://entra.microsoft.com/");
    expect(page.text).toContain("any organization and personal accounts");
    expect(page.text).toContain("this organization only");
    expect(page.text).toContain("publisher is verified");
    expect(page.text).toContain("offline_access");
    expect(page.text).toContain("Mail.ReadWrite");
    expect(page.text).toContain("Mail.Send");
    expect(page.text).toContain("MailboxSettings.ReadWrite");
    expect(page.text).toContain(`${app.url}/connect/microsoft/callback`);
    expect(page.text).toContain('data-copy="microsoft-redirect"');

    const device = await https(app, "POST", "/connect/microsoft/client", {
      cookie,
      body: new URLSearchParams({ csrf: csrfOf(page.text), client_id: MICROSOFT_ID, client_secret: "" }).toString(),
    });
    expect(device.status).toBe(302);
    const deviceRow = (await sql.query<{ client_id: string; secret_sealed: string | null }>(
      "SELECT client_id, secret_sealed FROM provider_clients WHERE provider = 'microsoft'",
    )).rows[0];
    expect(deviceRow).toEqual({ client_id: MICROSOFT_ID, secret_sealed: null });
    expect(app.config.microsoftMode).toBe("device");
    const deviceSlot = router(app).providerFor({ kind: "microsoft" });
    expect(deviceSlot).toBeInstanceOf(MicrosoftProvider);
    expect((deviceSlot as MicrosoftProvider).mode).toBe("device");
    const deviceHub = await https(app, "GET", "/connect", { cookie });
    expect(deviceHub.text).toContain("A Microsoft client is saved on this server.");
    expect(deviceHub.text).toContain("This asks you to type a code at Microsoft.");
    const deviceStart = await https(app, "GET", "/connect/microsoft", { cookie });
    expect(deviceStart.status).toBe(200);
    expect(deviceStart.text).toContain("This starts a code you type at Microsoft.");

    const saved = await https(app, "POST", "/connect/microsoft/client", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(deviceHub.text),
        client_id: MICROSOFT_ID,
        client_secret: MICROSOFT_SECRET,
      }).toString(),
    });
    expect(saved.status).toBe(302);
    expect(saved.text).not.toContain(MICROSOFT_SECRET);
    const row = (await sql.query<{ secret_sealed: string | null }>(
      "SELECT secret_sealed FROM provider_clients WHERE provider = 'microsoft'",
    )).rows[0];
    expect(row?.secret_sealed).toBeTruthy();
    expect(row?.secret_sealed).not.toBe(MICROSOFT_SECRET);
    expect(openSeal(app.config.encryptionKey, row?.secret_sealed ?? "")).toBe(MICROSOFT_SECRET);
    expect(app.config.microsoftMode).toBe("confidential");
    expect(app.config.microsoftClientFromEnv).toBe(false);
    const slot = router(app).providerFor({ kind: "microsoft" });
    expect(slot).toBeInstanceOf(MicrosoftProvider);
    expect((slot as MicrosoftProvider).mode).toBe("confidential");
    const hub = await https(app, "GET", "/connect", { cookie });
    expect(hub.text).toContain("This sends you to Microsoft and back here.");
    expect(hub.text).not.toContain(MICROSOFT_SECRET);
    expect(hub.text).not.toContain("Save Microsoft client");
    const started = await https(app, "GET", "/connect/microsoft", { cookie });
    expect(started.status).toBe(302);
    const authUrl = new URL(locationOf(started));
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe(MICROSOFT_ID);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(`${app.url}/connect/microsoft/callback`);
    expect(started.text).not.toContain(MICROSOFT_SECRET);

    const listed = await jsonPost(app, JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} },
    }));
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(MICROSOFT_SECRET);
    expect(lines.join("\n")).not.toContain(MICROSOFT_SECRET);
    expect(lines.join("\n")).toContain("microsoft client saved");

    const againLines: string[] = [];
    const again = await createServer(env({ ENCRYPTION_KEY: key, MAIL_PROVIDER: "live" }), {
      sql,
      logSink: (line) => againLines.push(line),
    });
    open.push(again);
    expect(again.config.microsoftClientId).toBe(MICROSOFT_ID);
    expect(again.config.microsoftClientSecret).toBe(MICROSOFT_SECRET);
    expect(again.config.microsoftMode).toBe("confidential");
    expect((router(again).providerFor({ kind: "microsoft" }) as MicrosoftProvider).mode).toBe("confidential");
    const next = await https(again, "GET", "/connect", { cookie });
    expect(next.text).toContain("A Microsoft client is saved on this server.");
    expect(next.text).not.toContain(MICROSOFT_SECRET);
    expect(againLines.join("\n")).not.toContain(MICROSOFT_SECRET);
  });

  it("does not replace a Microsoft client that came from the environment", async () => {
    const { app, sql } = await boot({
      MICROSOFT_CLIENT_ID: MICROSOFT_ID,
      MICROSOFT_CLIENT_SECRET: "env-microsoft-secret-value",
    });
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    const kept = await https(app, "POST", "/connect/microsoft/client", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(page.text),
        client_id: "22222222-3333-4444-8555-666666666666",
        client_secret: "another-microsoft-secret",
      }).toString(),
    });
    expect(kept.status).toBe(409);
    expect(kept.text).toContain("already has a Microsoft client");
    expect(kept.text).not.toContain("another-microsoft-secret");
    expect(kept.text).not.toContain("env-microsoft-secret-value");
    expect(app.config.microsoftClientId).toBe(MICROSOFT_ID);
    expect(app.config.microsoftMode).toBe("confidential");
    expect(await clientCount(sql)).toBe(0);
  });
});

const APP_PASSWORD = "app-password-secret";

function quietSession(): ImapSession {
  return { list: async () => [], logout: async () => {} } as ImapSession;
}

describe("/connect other email", () => {
  it("finds a preset, then connects read-only, and keeps a typed server", async () => {
    const lines: string[] = [];
    let opens = 0;
    let seenHost = "";
    let fetches = 0;
    const discoverDeps: DiscoverDeps = {
      timeoutMs: 500,
      allowPrivate: false,
      resolve: async () => ["203.0.113.20"],
      fetch: async () => {
        fetches += 1;
        return { status: 404, body: "", location: null };
      },
      probe: async () => false,
      mx: async () => [],
    };
    const { app, sql } = await boot({ MAIL_PROVIDER: "live" }, (line) => lines.push(line), {
      discover: discoverDeps,
      imap: {
        open: async (target) => {
          opens += 1;
          seenHost = target.servername;
          if (target.password !== APP_PASSWORD) throw new Error("bad password");
          return quietSession();
        },
        resolve: async () => ["203.0.113.20"],
        verifySmtp: async () => {},
      },
    });
    const cookie = await signIn(app);
    const page = await https(app, "GET", "/connect", { cookie });
    expect(page.text).toContain("Find settings");
    expect(page.text).toContain("Change server settings");

    const found = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(page.text),
        action: "find",
        email: "ada@icloud.com",
        password: APP_PASSWORD,
      }).toString(),
    });
    expect(found.status).toBe(200);
    expect(found.text).toContain("imap.mail.me.com");
    expect(found.text).toContain("smtp.mail.me.com");
    expect(found.text).toContain("https://support.apple.com/en-us/102654");
    expect(found.text).not.toContain(APP_PASSWORD);
    expect(fetches).toBe(0);
    expect(opens).toBe(0);
    expect(Number((await sql.query("SELECT count(*)::int AS n FROM accounts")).rows[0]?.n ?? 0)).toBe(0);

    const google = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(found.text),
        action: "connect",
        email: "ada@gmail.com",
        password: APP_PASSWORD,
      }).toString(),
    });
    expect(google.status).toBe(200);
    expect(google.text).toContain("This is a Google mailbox. Use Sign in with Google.");
    expect(opens).toBe(0);
    expect(fetches).toBe(0);

    const connected = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(found.text),
        action: "connect",
        email: "ada@icloud.com",
        password: APP_PASSWORD,
      }).toString(),
    });
    expect(connected.status, connected.text).toBe(200);
    expect(connected.text).toContain("Mailbox connected");
    expect(connected.text).toContain("ada@icloud.com");
    expect(connected.text).not.toContain(APP_PASSWORD);
    expect(opens).toBe(1);
    expect(seenHost).toBe("imap.mail.me.com");
    const box = await sql.query<{ save_sent: boolean | string; ciphertext: string }>(
      `SELECT m.save_sent, t.ciphertext
       FROM imap_mailboxes m JOIN provider_tokens t ON t.account_id = m.account_id`,
    );
    expect(box.rows).toHaveLength(1);
    const saved = box.rows[0];
    const kept = saved?.save_sent;
    expect(kept === false || kept === "f" || kept === "false").toBe(true);
    expect(saved?.ciphertext ?? "").not.toContain(APP_PASSWORD);
    expect(openSeal(app.config.encryptionKey, saved?.ciphertext ?? "")).toBe(APP_PASSWORD);
    expect(lines.join("\n")).not.toContain(APP_PASSWORD);

    const typed = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({
        csrf: csrfOf(page.text),
        action: "connect",
        email: "ada@example.com",
        password: APP_PASSWORD,
        host: "mail.example.test",
        port: "993",
        security: "tls",
        smtpHost: "smtp.example.test",
        smtpPort: "587",
        user: "ada@example.com",
      }).toString(),
    });
    expect(typed.status, typed.text).toBe(200);
    expect(seenHost).toBe("mail.example.test");
    expect(fetches).toBe(0);
    const flags = await sql.query<{ email: string; save_sent: boolean | string }>(
      `SELECT a.email, m.save_sent FROM accounts a JOIN imap_mailboxes m ON m.account_id = a.id WHERE a.email = 'ada@example.com'`,
    );
    const flag = flags.rows[0]?.save_sent;
    expect(flag === true || flag === "t" || flag === "true").toBe(true);

    const denied = await https(app, "POST", "/connect/other", {
      body: new URLSearchParams({ csrf: "no", action: "find", email: "ada@icloud.com" }).toString(),
    });
    expect(denied.status).toBe(401);
    const expired = await https(app, "POST", "/connect/other", {
      cookie,
      body: new URLSearchParams({ csrf: "no", action: "find", email: "ada@icloud.com" }).toString(),
    });
    expect(expired.status).toBe(400);
    expect(expired.text).not.toContain(APP_PASSWORD);
    expect((await https(app, "GET", "/connect/other", { cookie })).status).toBe(405);
  });

  it("server_info reports the public URL and which providers are set up", async () => {
    const lines: string[] = [];
    const live = await boot({
      PUBLIC_URL: "https://mail.example.com",
      GOOGLE_CLIENT_ID: GOOGLE_ID,
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
      MICROSOFT_CLIENT_ID: MICROSOFT_ID,
      MAIL_PROVIDER: "live",
    }, (line) => lines.push(line));
    const listed = await jsonPost(live.app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "server_info", arguments: { account: "gmail_work" } },
    }));
    expect(listed.status).toBe(200);
    expect(toolData(listed.text)).toEqual({
      publicUrl: "https://mail.example.com",
      version: "0.9.0",
      providers: { google: true, microsoft: true, imap: true },
    });
    expect(listed.text).not.toContain(GOOGLE_SECRET);
    expect(listed.text).not.toContain(MICROSOFT_ID);
    expect(lines.join("\n")).not.toContain(GOOGLE_SECRET);

    const gmail = await boot({
      MAIL_PROVIDER: "gmail",
      GOOGLE_CLIENT_ID: GOOGLE_ID,
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    });
    const gmailInfo = await jsonPost(gmail.app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    }));
    expect(toolData(gmailInfo.text)).toEqual({
      publicUrl: "",
      version: "0.9.0",
      providers: { google: true, microsoft: false, imap: false },
    });

    const empty = await boot();
    const emptyInfo = await jsonPost(empty.app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    }));
    expect(toolData(emptyInfo.text)).toEqual({
      publicUrl: "",
      version: "0.9.0",
      providers: { google: false, microsoft: false, imap: false },
    });
    expect(JSON.stringify(toolData(emptyInfo.text))).not.toMatch(/secret|token|password/i);
  });

  it("server_info counts a saved client when the env has none, and returns no secret", async () => {
    const lines: string[] = [];
    const secret = "saved-client-secret-must-not-appear";
    const google = await boot({}, (line) => lines.push(line));
    await google.sql.query(
      `INSERT INTO provider_clients (provider, client_id, secret_sealed, created_at)
       VALUES ('google', $1, $2, $3)`,
      ["saved-google.apps.googleusercontent.com", secret, "2026-11-06T00:00:00.000Z"],
    );
    const googleInfo = await jsonPost(google.app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    }));
    const googleBody = toolData(googleInfo.text);
    expect(googleBody).toEqual({
      publicUrl: "",
      version: "0.9.0",
      providers: { google: true, microsoft: false, imap: false },
    });
    expect(googleInfo.text).not.toContain(secret);
    expect(JSON.stringify(googleBody)).not.toMatch(/secret/i);
    expect(lines.join("\n")).not.toContain(secret);

    const microsoft = await boot({}, (line) => lines.push(line));
    await microsoft.sql.query(
      `INSERT INTO provider_clients (provider, client_id, secret_sealed, created_at)
       VALUES ('microsoft', $1, NULL, $2)`,
      ["saved-microsoft-client", "2026-11-06T00:00:00.000Z"],
    );
    const microsoftInfo = await jsonPost(microsoft.app, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "server_info", arguments: {} },
    }));
    const microsoftBody = toolData(microsoftInfo.text);
    expect(microsoftBody).toEqual({
      publicUrl: "",
      version: "0.9.0",
      providers: { google: false, microsoft: true, imap: false },
    });
    expect(JSON.stringify(microsoftBody)).not.toMatch(/secret/i);
    expect(microsoftInfo.text).not.toContain(secret);
  });
});
