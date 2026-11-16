import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { MICROSOFT_SCOPES } from "../auth/resource.js";
import { DEVICE_BLOCKED_MESSAGE } from "../providers/microsoft.js";
import { FakeMicrosoftServer } from "../providers/microsoft-fake-server.js";
import { createServer, type Running } from "./app.js";

const PASSPHRASE = "correct-horse-battery-staple";

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

const open: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (open.length > 0) {
    const item = open.pop();
    if (item) await item.close();
  }
});

function env(extra: Record<string, string>, microsoft: FakeMicrosoftServer): Record<string, string> {
  return {
    OWNER_TOKEN: "test-owner-token-do-not-log-0123456789",
    OWNER_PASSPHRASE: PASSPHRASE,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_MODE: "mirror",
    MAIL_STORE: "pglite",
    MAIL_PROVIDER: "fake",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    MICROSOFT_CLIENT_ID: "ms-client",
    MICROSOFT_GRAPH_BASE: microsoft.graphBase,
    MICROSOFT_TOKEN_URL: microsoft.tokenUrl,
    MICROSOFT_AUTH_URL: microsoft.authUrl,
    MICROSOFT_DEVICE_URL: microsoft.deviceUrl,
    ...extra,
  };
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

function https(app: Running, method: string, path: string, options: { cookie?: string; body?: string; type?: string } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${app.url}${path}`);
    const headers: Record<string, string> = {};
    if (options.cookie) headers.cookie = options.cookie;
    if (options.type) headers["content-type"] = options.type;
    const payload = Buffer.from(options.body ?? "");
    if (options.body !== undefined) headers["content-length"] = String(payload.length);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      ca: app.cert,
      servername: "localhost",
    }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.end(payload);
    else req.end();
  });
}

function httpGet(url: string): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "GET",
    }, (res) => {
      res.resume();
      const location = res.headers.location;
      resolve({ status: res.statusCode ?? 0, location: Array.isArray(location) ? location[0] ?? "" : location ?? "" });
    });
    req.on("error", reject);
    req.end();
  });
}

async function boot(microsoft: FakeMicrosoftServer, extra: Record<string, string> = {}, clock?: { now: () => number }, logs?: string[]): Promise<Running> {
  const app = await createServer(env(extra, microsoft), { clock, logSink: logs ? (line) => logs.push(line) : undefined });
  open.push(app);
  return app;
}

async function signIn(app: Running): Promise<string> {
  const page = await https(app, "GET", "/signin");
  expect(page.status).toBe(200);
  const posted = await https(app, "POST", "/signin", {
    cookie: cookieOf(page),
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(page.text), passphrase: PASSPHRASE }).toString(),
  });
  expect(posted.status, posted.text).toBe(200);
  return cookieOf(posted);
}

function tokenPosts(microsoft: FakeMicrosoftServer): string[] {
  return microsoft.recorded().filter((row) => row.path.startsWith("/common/oauth2/v2.0/token")).map((row) => row.body);
}

describe("microsoft sign-in", () => {
  it("sends no client secret in device mode, and polls once per status only after the interval", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    open.push(microsoft);
    microsoft.devicePoll = "pending";
    let now = Date.parse("2026-11-05T15:00:00.000Z");
    const logs: string[] = [];
    const app = await boot(microsoft, {}, { now: () => now }, logs);
    const cookie = await signIn(app);
    const form = await https(app, "GET", "/connect/microsoft", { cookie });
    expect(form.status).toBe(200);
    const started = await https(app, "POST", "/connect/microsoft", {
      cookie,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(form.text) }).toString(),
    });
    expect(started.status, started.text).toBe(200);
    expect(started.text).toContain("ABCD-EFGH");
    expect(started.text).toContain("Open microsoft.com/devicelogin, type this code, and sign in. This page finishes by itself.");
    expect(started.text).toContain('id="user-code"');
    expect(started.text).toContain('id="copy-code"');
    expect(started.text).toContain('target="_blank"');
    expect(started.text).toContain('rel="noopener"');
    expect(started.text).not.toContain(microsoft.issuedDeviceCode);
    const deviceBody = new URLSearchParams(microsoft.recorded().find((row) => row.path.startsWith("/common/oauth2/v2.0/devicecode"))?.body ?? "");
    expect(deviceBody.get("client_id")).toBe("ms-client");
    expect(deviceBody.get("scope")).toBe(MICROSOFT_SCOPES);
    expect(deviceBody.has("client_secret")).toBe(false);
    const again = await https(app, "GET", "/connect/microsoft", { cookie });
    expect(again.text).toContain("ABCD-EFGH");
    expect(microsoft.recorded().filter((row) => row.path.startsWith("/common/oauth2/v2.0/devicecode"))).toHaveLength(1);

    const first = await https(app, "GET", "/connect/microsoft/device/status", { cookie });
    expect(JSON.parse(first.text)).toEqual({ status: "pending", interval: 5 });
    const held = await https(app, "GET", "/connect/microsoft/device/status", { cookie });
    expect(JSON.parse(held.text)).toEqual({ status: "pending", interval: 5 });
    expect(tokenPosts(microsoft)).toHaveLength(1);
    expect(tokenPosts(microsoft)[0]).not.toContain("client_secret");

    microsoft.devicePoll = "slow_down";
    now += 5_000;
    const slowed = await https(app, "GET", "/connect/microsoft/device/status", { cookie });
    expect(JSON.parse(slowed.text)).toEqual({ status: "pending", interval: 10 });
    now += 6_000;
    const still = await https(app, "GET", "/connect/microsoft/device/status", { cookie });
    expect(JSON.parse(still.text)).toEqual({ status: "pending", interval: 10 });
    expect(tokenPosts(microsoft)).toHaveLength(2);
    now += 4_000;
    await https(app, "GET", "/connect/microsoft/device/status", { cookie });
    expect(tokenPosts(microsoft)).toHaveLength(3);
    expect(logs.join("\n")).not.toContain(microsoft.issuedDeviceCode);
  });

  it("refuses another session, an expired code, and a used code without a token request", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    open.push(microsoft);
    let now = Date.parse("2026-11-05T15:00:00.000Z");
    const app = await boot(microsoft, {}, { now: () => now });
    const first = await signIn(app);
    const second = await signIn(app);
    const form = await https(app, "GET", "/connect/microsoft", { cookie: first });
    const started = await https(app, "POST", "/connect/microsoft", {
      cookie: first,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(form.text) }).toString(),
    });
    expect(started.status).toBe(200);
    const other = await https(app, "GET", "/connect/microsoft/device/status", { cookie: second });
    expect(JSON.parse(other.text).message).toBe("That code is not for this sign-in.");
    expect(tokenPosts(microsoft)).toHaveLength(0);

    now += 901_000;
    const expired = await https(app, "GET", "/connect/microsoft/device/status", { cookie: first });
    expect(JSON.parse(expired.text).message).toBe("That code expired. Start again.");
    expect(tokenPosts(microsoft)).toHaveLength(0);

    now = Date.parse("2026-11-05T16:00:00.000Z");
    const restarted = await https(app, "POST", "/connect/microsoft", {
      cookie: first,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(form.text) }).toString(),
    });
    expect(restarted.status).toBe(200);
    const done = await https(app, "GET", "/connect/microsoft/device/status", { cookie: first });
    expect(JSON.parse(done.text)).toEqual({ status: "done" });
    const used = await https(app, "GET", "/connect/microsoft/device/status", { cookie: first });
    expect(JSON.parse(used.text).message).toBe("That code is not for this sign-in.");
    expect(tokenPosts(microsoft)).toHaveLength(1);
    const accounts = await app.store.listAccounts();
    expect(accounts.some((account) => account.kind === "microsoft" && account.email === "owner@outlook.example")).toBe(true);
    const audit = await app.store.listAudit();
    expect(audit.some((row) => row.tool === "connect_microsoft")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(microsoft.issuedDeviceCode);
  });

  it("says when the tenant turned device code off", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    open.push(microsoft);
    microsoft.blockDeviceCode = true;
    const app = await boot(microsoft);
    const cookie = await signIn(app);
    const form = await https(app, "GET", "/connect/microsoft", { cookie });
    const started = await https(app, "POST", "/connect/microsoft", {
      cookie,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(form.text) }).toString(),
    });
    expect(started.status).toBe(400);
    expect(started.text).toContain(DEVICE_BLOCKED_MESSAGE);
    expect(tokenPosts(microsoft)).toHaveLength(0);
  });

  it("refuses a callback state from another session, an old state, or a used state without a token request", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    open.push(microsoft);
    microsoft.requireSecret = true;
    let now = Date.parse("2026-11-05T15:00:00.000Z");
    const logs: string[] = [];
    const app = await boot(microsoft, { MICROSOFT_CLIENT_SECRET: "ms-secret-DO-NOT-LOG" }, { now: () => now }, logs);
    const first = await signIn(app);
    const second = await signIn(app);
    const started = await https(app, "GET", "/connect/microsoft", { cookie: first });
    expect(started.status).toBe(302);
    const authorize = new URL(String(started.headers.location));
    expect(authorize.searchParams.get("scope")).toBe(MICROSOFT_SCOPES);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("response_mode")).toBe("query");
    expect(authorize.searchParams.get("prompt")).toBe("select_account");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${app.url}/connect/microsoft/callback`);
    const state = authorize.searchParams.get("state") ?? "";
    const other = await https(app, "GET", `/connect/microsoft/callback?state=${state}&code=nope`, { cookie: second });
    expect(other.status).toBe(400);
    expect(tokenPosts(microsoft)).toHaveLength(0);

    now += 11 * 60 * 1000;
    const stale = await https(app, "GET", `/connect/microsoft/callback?state=${state}&code=nope`, { cookie: first });
    expect(stale.status).toBe(400);
    expect(tokenPosts(microsoft)).toHaveLength(0);

    now = Date.parse("2026-11-05T15:30:00.000Z");
    const fresh = await https(app, "GET", "/connect/microsoft", { cookie: first });
    const approved = await httpGet(String(fresh.headers.location));
    expect(approved.status).toBe(302);
    const back = new URL(approved.location);
    const done = await https(app, "GET", `${back.pathname}${back.search}`, { cookie: first });
    expect(done.status, done.text).toBe(200);
    expect(done.text).toContain("owner@outlook.example");
    const secretBody = new URLSearchParams(tokenPosts(microsoft)[0] ?? "");
    expect(secretBody.get("client_secret")).toBe("ms-secret-DO-NOT-LOG");
    expect(secretBody.get("code_verifier")).toBeTruthy();
    const replay = await https(app, "GET", `${back.pathname}${back.search}`, { cookie: first });
    expect(replay.status).toBe(400);
    expect(tokenPosts(microsoft)).toHaveLength(1);
    expect(logs.join("\n")).not.toContain(secretBody.get("code") ?? "missing-code");
    expect(logs.join("\n")).not.toContain("ms-secret-DO-NOT-LOG");
  });

  it("does not redeem a device-mode callback or a confidential-mode device status", async () => {
    const microsoft = await FakeMicrosoftServer.scripted();
    open.push(microsoft);
    const deviceApp = await boot(microsoft);
    const cookie = await signIn(deviceApp);
    const callback = await https(deviceApp, "GET", "/connect/microsoft/callback?state=abc&code=def", { cookie });
    expect(callback.status).toBe(400);
    expect(tokenPosts(microsoft)).toHaveLength(0);

    const confidential = await boot(microsoft, { MICROSOFT_CLIENT_SECRET: "ms-secret-DO-NOT-LOG" });
    const signed = await signIn(confidential);
    const status = await https(confidential, "GET", "/connect/microsoft/device/status", { cookie: signed });
    expect(JSON.parse(status.text).status).toBe("error");
    expect(tokenPosts(microsoft)).toHaveLength(0);
  });
});
