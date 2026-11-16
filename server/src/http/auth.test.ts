import { createHash, randomBytes } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest, type IncomingHttpHeaders } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { openSeal } from "../crypto/seal.js";
import { FakeGmailServer } from "../providers/gmail-fake-server.js";
import { GOOGLE_SCOPES } from "../auth/resource.js";
import { isPrivateHost, redirectAllowed } from "../auth/service.js";
import { loadConfig } from "../config.js";
import { openSql, type Sql } from "../store/sql.js";
import { createServer, type Running } from "./app.js";

const TOKEN = "test-owner-token-do-not-log-0123456789";
const PASSPHRASE = "correct-horse-battery-staple";
const WRONG = "wrong-passphrase-do-not-log";
const VERIFIER = "a".repeat(43);
const REDIRECT = "http://127.0.0.1:9/callback";

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

function challenge(): string {
  return createHash("sha256").update(VERIFIER).digest("base64url");
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

function requestOnce(
  protocol: "http" | "https",
  url: string,
  ca: string | undefined,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(body ?? "");
    const transport = protocol === "https" ? httpsRequest : httpRequest;
    const req = transport({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: body === undefined ? headers : { ...headers, "content-length": String(payload.length) },
      ca,
      ...(protocol === "https" ? { servername: "localhost" } : {}),
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
    if (body !== undefined) req.end(payload);
    else req.end();
  });
}

function https(app: Running, method: string, path: string, options: { cookie?: string; body?: string; type?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.type) headers["content-type"] = options.type;
  return requestOnce("https", `${app.url}${path}`, app.cert, method, headers, options.body);
}

async function boot(extra: Record<string, string | undefined> = {}, options: { clock?: { now: () => number }; sql?: Sql } = {}): Promise<Running> {
  const app = await createServer(env(extra), options);
  open.push(app);
  return app;
}

async function cimd(redirectUri: string): Promise<string> {
  let port = 0;
  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const clientId = `http://127.0.0.1:${port}${req.url ?? "/"}`;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      client_id: clientId,
      client_name: "Test Claude",
      redirect_uris: [redirectUri],
    }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  open.push({
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  });
  return `http://127.0.0.1:${port}/client.json`;
}

function authorizeQuery(clientId: string, resource: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge(),
    code_challenge_method: "S256",
    resource,
    scope: "mail",
    state: "state-1",
    ...extra,
  });
  return `/authorize?${query.toString()}`;
}

async function allow(app: Running, path: string, clientName = "Test Claude"): Promise<{ code: string; location: URL; cookie: string }> {
  const start = await https(app, "GET", path);
  expect(start.status, start.text).toBe(200);
  const firstCookie = cookieOf(start);
  const signed = await https(app, "POST", "/authorize", {
    cookie: firstCookie,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE }).toString(),
  });
  expect(signed.status, signed.text).toBe(200);
  expect(signed.text).toContain("Let Claude use your mail?");
  expect(signed.text).toContain(clientName);
  const cookie = cookieOf(signed) || firstCookie;
  const allowed = await https(app, "POST", "/authorize", {
    cookie,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(signed.text), decision: "allow" }).toString(),
  });
  expect(allowed.status, allowed.text).toBe(302);
  const location = new URL(locationOf(allowed));
  const code = location.searchParams.get("code") ?? "";
  expect(code).not.toBe("");
  expect(location.searchParams.get("state")).toBe("state-1");
  expect(location.searchParams.get("iss")).toBe(app.url);
  return { code, location, cookie };
}

async function tokenFor(app: Running, clientId: string, code: string, extra: Record<string, string> = {}): Promise<Answer> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: VERIFIER,
    resource: `${app.url}/mcp`,
    ...extra,
  });
  return https(app, "POST", "/token", {
    type: "application/x-www-form-urlencoded",
    body: body.toString(),
  });
}

function mcpBody(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
}

async function mcp(app: Running, token: string, id: number, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  return https(app, "POST", "/mcp", {
    type: "application/json",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: mcpBody(id, method, params),
  });
}

function toolText(res: Answer): { isError: boolean; message: string } {
  const parsed = JSON.parse(res.text.includes("\ndata:") ? res.text.split("\n").filter((line) => line.startsWith("data:")).pop()?.slice(5).trim() ?? "{}" : res.text) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = parsed.result?.content?.[0]?.text ?? "";
  const data = text ? JSON.parse(text) as { message?: string } : {};
  return { isError: Boolean(parsed.result?.isError), message: data.message ?? "" };
}

async function signIn(app: Running): Promise<string> {
  const page = await https(app, "GET", "/signin");
  expect(page.status).toBe(200);
  const cookie = cookieOf(page);
  const posted = await https(app, "POST", "/signin", {
    cookie,
    type: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrf: csrfOf(page.text), passphrase: PASSPHRASE }).toString(),
  });
  expect(posted.status, posted.text).toBe(200);
  return cookieOf(posted) || cookie;
}

describe("oauth metadata", () => {
  it("serves both discovery documents and a 401 with resource_metadata", async () => {
    const app = await boot();
    const resource = await https(app, "GET", "/.well-known/oauth-protected-resource");
    expect(resource.status).toBe(200);
    expect(resource.headers["access-control-allow-origin"]).toBe("*");
    const resourceBody = JSON.parse(resource.text) as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
    expect(resourceBody.resource).toBe(`${app.url}/mcp`);
    expect(resourceBody.authorization_servers).toEqual([app.url]);
    expect(resourceBody.scopes_supported).toEqual(["mail"]);
    const pathForm = await https(app, "GET", "/.well-known/oauth-protected-resource/mcp");
    expect(pathForm.status).toBe(200);
    const server = await https(app, "GET", "/.well-known/oauth-authorization-server");
    const serverBody = JSON.parse(server.text) as { issuer: string; code_challenge_methods_supported: string[]; client_id_metadata_document_supported: boolean };
    expect(server.status).toBe(200);
    expect(serverBody.issuer).toBe(app.url);
    expect(serverBody.code_challenge_methods_supported).toEqual(["S256"]);
    expect(serverBody.client_id_metadata_document_supported).toBe(true);
    const missing = await https(app, "POST", "/mcp", {
      type: "application/json",
      headers: { accept: "application/json, text/event-stream" },
      body: "{}",
    });
    expect(missing.status).toBe(401);
    expect(String(missing.headers["www-authenticate"])).toContain(`resource_metadata="${app.url}/.well-known/oauth-protected-resource"`);
    expect(String(missing.headers["www-authenticate"])).not.toContain("invalid_token");
    const get = await https(app, "GET", "/mcp");
    expect(get.status).toBe(401);
    const wrong = await https(app, "POST", "/mcp", {
      type: "application/json",
      headers: { authorization: "Bearer wrong-bearer-do-not-echo", accept: "application/json, text/event-stream" },
      body: "{}",
    });
    expect(wrong.status).toBe(401);
    expect(String(wrong.headers["www-authenticate"])).toContain("invalid_token");
    expect(wrong.text).not.toContain("wrong-bearer-do-not-echo");
  });
});

describe("client id metadata and dynamic registration", () => {
  it("completes a S256 code flow and calls a tool", async () => {
    const app = await boot();
    const clientId = await cimd(REDIRECT);
    const allowed = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const issued = await tokenFor(app, clientId, allowed.code);
    expect(issued.status, issued.text).toBe(200);
    const tokens = JSON.parse(issued.text) as { access_token: string; refresh_token: string; expires_in: number };
    expect(tokens.expires_in).toBe(3600);
    const hello = await mcp(app, tokens.access_token, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "cimd", version: "0" },
    });
    expect(hello.status, hello.text).toBe(200);
    expect(hello.text).toContain("protocolVersion");
    const owner = await mcp(app, TOKEN, 2, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "owner", version: "0" },
    });
    expect(owner.status).toBe(200);
  });

  it("registers a public client and a confidential client", async () => {
    const app = await boot();
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    const pub = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Public",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(pub.status).toBe(201);
    const publicClient = JSON.parse(pub.text) as { client_id: string; client_secret?: string };
    expect(publicClient.client_secret).toBeUndefined();
    const allowed = await allow(app, authorizeQuery(publicClient.client_id, `${app.url}/mcp`), "Public");
    const issued = await tokenFor(app, publicClient.client_id, allowed.code);
    expect(issued.status, issued.text).toBe(200);
    const secretClient = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Secret",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    expect(secretClient.status).toBe(201);
    const confidential = JSON.parse(secretClient.text) as { client_id: string; client_secret: string };
    expect(confidential.client_secret.length).toBeGreaterThan(20);
    expect(lines.join("\n")).not.toContain(confidential.client_secret);
    const second = await allow(app, authorizeQuery(confidential.client_id, `${app.url}/mcp`), "Secret");
    const denied = await tokenFor(app, confidential.client_id, second.code);
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.text).error).toBe("invalid_client");
    const accepted = await tokenFor(app, confidential.client_id, second.code, { client_secret: confidential.client_secret });
    expect(accepted.status).toBe(200);
    const issuedSecret = JSON.parse(accepted.text) as { access_token?: string };
    expect(issuedSecret.access_token?.length ?? 0).toBeGreaterThan(20);
    expect(lines.join("\n")).not.toContain(confidential.client_secret);
    expect(lines.join("\n")).not.toContain(issuedSecret.access_token);
  });

  it("refuses a redirect host that is not on the list, including a metadata document, before sign-in", async () => {
    const app = await boot();
    const refused = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://attacker.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.text).error).toBe("invalid_client_metadata");
    expect(refused.text).not.toContain("attacker.example");
    const suffix = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai.attacker.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(suffix.status).toBe(400);
    const created = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(created.status).toBe(201);
    const client = JSON.parse(created.text) as { client_id: string };
    const start = await https(app, "GET", authorizeQuery(client.client_id, `${app.url}/mcp`, {
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    }));
    expect(start.status).toBe(200);
    expect(start.text).toContain("Use the passphrase");
    const signed = await https(app, "POST", "/authorize", {
      cookie: cookieOf(start),
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE }).toString(),
    });
    expect(signed.status).toBe(200);
    expect(signed.text).toContain("After you allow, you go back to claude.ai");
    expect(signed.text).toContain(">Allow<");
    expect(signed.text).not.toContain("This client is at");
    const stolen = await https(app, "GET", authorizeQuery(client.client_id, `${app.url}/mcp`, {
      redirect_uri: "https://attacker.example/cb",
    }));
    expect(stolen.status).toBe(400);
    expect(stolen.text).not.toContain("Use the passphrase");
    expect(stolen.text).not.toContain(">Allow<");
    expect(stolen.text).not.toContain("attacker.example");
    const cookie = await signIn(app);
    const signedIn = await https(app, "GET", authorizeQuery(client.client_id, `${app.url}/mcp`, {
      redirect_uri: "https://attacker.example/cb",
    }), { cookie });
    expect(signedIn.status).toBe(400);
    expect(signedIn.text).not.toContain(">Allow<");
    expect(signedIn.text).not.toContain("Use the passphrase");
    const metadata = await cimd("https://attacker.example/cb");
    const listed = await https(app, "GET", authorizeQuery(metadata, `${app.url}/mcp`, {
      redirect_uri: "https://attacker.example/cb",
    }));
    expect(listed.status).toBe(400);
    expect(listed.text).not.toContain("Use the passphrase");
    expect(listed.text).not.toContain(">Allow<");
    expect(listed.text).not.toContain("attacker.example");
  });

  it("names the redirect host and the metadata client host on the consent page", async () => {
    const app = await boot();
    const clientId = await cimd(REDIRECT);
    const start = await https(app, "GET", authorizeQuery(clientId, `${app.url}/mcp`));
    expect(start.status).toBe(200);
    const signed = await https(app, "POST", "/authorize", {
      cookie: cookieOf(start),
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(start.text), passphrase: PASSPHRASE }).toString(),
    });
    expect(signed.status).toBe(200);
    expect(signed.text).toContain("After you allow, you go back to 127.0.0.1");
    expect(signed.text).toContain("This client is at 127.0.0.1");
    expect(signed.text).toContain(">Allow<");
  });

  it("stops registering after 20 clients in an hour and after 100 stored clients", async () => {
    let now = Date.parse("2026-11-05T12:00:00.000Z");
    const settings = env();
    const sql = await openSql(loadConfig(settings));
    open.push({ close: () => sql.close() });
    const clock = { now: () => now };
    const first = await createServer(settings, { sql, clock });
    const second = await createServer(settings, { sql, clock });
    open.push(first, second);
    const body = JSON.stringify({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    const servers = [first, second];
    for (let i = 0; i < 20; i += 1) {
      const res = await https(servers[i % 2]!, "POST", "/register", { type: "application/json", body });
      expect(res.status, String(i)).toBe(201);
    }
    const blocked = await https(second, "POST", "/register", { type: "application/json", body });
    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.text).error).toBe("rate_limited");
    now += 60 * 60 * 1000 + 1;
    const again = await https(first, "POST", "/register", { type: "application/json", body });
    expect(again.status).toBe(201);
    await sql.query(
      `INSERT INTO oauth_clients (client_id, secret_hash, redirect_uris, client_name, auth_method, created_at)
       SELECT 'seed-' || g::text, NULL, '["http://127.0.0.1:9/callback"]'::jsonb, 'seed', 'none', '2026-11-04T00:00:00.000Z'
       FROM generate_series(1, 79) AS g`,
    );
    const full = await https(second, "POST", "/register", { type: "application/json", body });
    expect(full.status).toBe(429);
    expect(JSON.parse(full.text).error).toBe("rate_limited");
    const count = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM oauth_clients");
    expect(Number(count.rows[0]?.n)).toBe(100);
  });
});

describe("refused tokens and grants", () => {
  it("refuses an expired token, a wrong audience, and a replayed refresh token", async () => {
    let now = Date.parse("2026-11-05T12:00:00.000Z");
    const app = await boot({}, { clock: { now: () => now } });
    const clientId = await cimd(REDIRECT);
    const allowed = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const issued = await tokenFor(app, clientId, allowed.code);
    const first = JSON.parse(issued.text) as { access_token: string; refresh_token: string };
    now += 60 * 60 * 1000 + 1000;
    const expired = await mcp(app, first.access_token, 1, "tools/list");
    expect(expired.status).toBe(401);
    now = Date.parse("2026-11-05T12:00:00.000Z");
    const again = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const live = JSON.parse((await tokenFor(app, clientId, again.code)).text) as { access_token: string; refresh_token: string };
    const foreign = await mcp(app, live.access_token, 2, "tools/list", undefined, { host: "evil.example" });
    expect(foreign.status).toBe(401);
    expect(String(foreign.headers["www-authenticate"])).toContain("invalid_token");
    const rotated = await https(app, "POST", "/token", {
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: live.refresh_token,
        client_id: clientId,
        resource: `${app.url}/mcp`,
      }).toString(),
    });
    expect(rotated.status, rotated.text).toBe(200);
    const next = JSON.parse(rotated.text) as { access_token: string; refresh_token: string };
    const replay = await https(app, "POST", "/token", {
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: live.refresh_token,
        client_id: clientId,
        resource: `${app.url}/mcp`,
      }).toString(),
    });
    expect(replay.status).toBe(400);
    expect(JSON.parse(replay.text).error).toBe("invalid_grant");
    expect((await mcp(app, live.access_token, 3, "tools/list")).status).toBe(401);
    expect((await mcp(app, next.access_token, 4, "tools/list")).status).toBe(401);
    const chained = await https(app, "POST", "/token", {
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: next.refresh_token,
        client_id: clientId,
        resource: `${app.url}/mcp`,
      }).toString(),
    });
    expect(chained.status).toBe(400);
    expect(JSON.parse(chained.text).error).toBe("invalid_grant");
  });

  it("refuses plain PKCE, a missing challenge, a redirect mismatch, and a reused or expired code", async () => {
    let now = Date.parse("2026-11-05T12:00:00.000Z");
    const app = await boot({}, { clock: { now: () => now } });
    const clientId = await cimd(REDIRECT);
    const plain = await https(app, "GET", authorizeQuery(clientId, `${app.url}/mcp`, { code_challenge_method: "plain" }));
    expect([400, 302]).toContain(plain.status);
    const plainUrl = locationOf(plain);
    if (plain.status === 302) {
      const parsed = new URL(plainUrl);
      expect(parsed.searchParams.get("error")).toBeTruthy();
      expect(parsed.searchParams.has("code")).toBe(false);
      expect(parsed.origin).toBe("http://127.0.0.1:9");
    }
    const missing = await https(app, "GET", authorizeQuery(clientId, `${app.url}/mcp`, { code_challenge: "", code_challenge_method: "" }));
    expect([400, 302]).toContain(missing.status);
    if (missing.status === 302) expect(new URL(locationOf(missing)).searchParams.has("code")).toBe(false);
    const evil = await https(app, "GET", authorizeQuery(clientId, `${app.url}/mcp`, { redirect_uri: "https://evil.example/steal" }));
    expect(evil.status).toBe(400);
    expect(locationOf(evil)).toBe("");
    expect(evil.text).not.toContain("https://evil.example/steal");
    const once = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const first = await tokenFor(app, clientId, once.code);
    expect(first.status).toBe(200);
    const reused = await tokenFor(app, clientId, once.code);
    expect(reused.status).toBe(400);
    expect(JSON.parse(reused.text).error).toBe("invalid_grant");
    const fresh = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    now += 61_000;
    const expired = await tokenFor(app, clientId, fresh.code);
    expect(expired.status).toBe(400);
    expect(JSON.parse(expired.text).error).toBe("invalid_grant");
  });

  it("revokes the tokens from an authorization code when that code is redeemed twice", async () => {
    const app = await boot();
    const clientId = await cimd(REDIRECT);
    const allowed = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const issued = await tokenFor(app, clientId, allowed.code);
    expect(issued.status).toBe(200);
    const tokens = JSON.parse(issued.text) as { access_token: string; refresh_token: string };
    const hello = await mcp(app, tokens.access_token, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "once", version: "0" },
    });
    expect(hello.status).toBe(200);
    const reused = await tokenFor(app, clientId, allowed.code);
    expect(reused.status).toBe(400);
    expect(JSON.parse(reused.text).error).toBe("invalid_grant");
    expect((await mcp(app, tokens.access_token, 2, "tools/list")).status).toBe(401);
    const refresh = await https(app, "POST", "/token", {
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        resource: `${app.url}/mcp`,
      }).toString(),
    });
    expect(refresh.status).toBe(400);
    expect(JSON.parse(refresh.text).error).toBe("invalid_grant");
  });
});

describe("passphrase limits", () => {
  it("refuses a wrong passphrase and keeps the limit across two servers", async () => {
    const settings = env();
    const sql = await openSql(loadConfig(settings));
    open.push({ close: () => sql.close() });
    const first = await createServer(settings, { sql });
    const second = await createServer(settings, { sql });
    open.push(first, second);
    const page = await https(first, "GET", "/signin");
    const cookie = cookieOf(page);
    const csrf = csrfOf(page.text);
    const servers = [first, second];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await https(servers[attempt % 2]!, "POST", "/signin", {
        cookie,
        type: "application/x-www-form-urlencoded",
        body: new URLSearchParams({ csrf, passphrase: WRONG }).toString(),
      });
      expect(res.status).toBe(401);
      expect(res.text).not.toContain(WRONG);
      expect(res.text).not.toContain(PASSPHRASE);
    }
    const blocked = await https(second, "POST", "/signin", {
      cookie,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf, passphrase: PASSPHRASE }).toString(),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain("Too many tries");
  });

  it("shares the global limit across addresses", async () => {
    const settings = env({ TRUST_PROXY: "1" });
    const sql = await openSql(loadConfig(settings));
    open.push({ close: () => sql.close() });
    const first = await createServer(settings, { sql });
    const second = await createServer(settings, { sql });
    open.push(first, second);
    const page = await https(first, "GET", "/signin");
    const cookie = cookieOf(page);
    const csrf = csrfOf(page.text);
    const servers = [first, second];
    for (let address = 1; address <= 5; address += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await https(servers[(address + attempt) % 2]!, "POST", "/signin", {
          cookie,
          type: "application/x-www-form-urlencoded",
          headers: { "x-forwarded-for": `203.0.113.${address}` },
          body: new URLSearchParams({ csrf, passphrase: WRONG }).toString(),
        });
        expect(res.status, `${address}.${attempt}`).toBe(401);
      }
    }
    const blocked = await https(first, "POST", "/signin", {
      cookie,
      type: "application/x-www-form-urlencoded",
      headers: { "x-forwarded-for": "203.0.113.6" },
      body: new URLSearchParams({ csrf, passphrase: WRONG }).toString(),
    });
    expect(blocked.status).toBe(429);
  });
});

describe("connecting Gmail", () => {
  async function gmailApp(fake: FakeGmailServer, sql?: Sql): Promise<Running> {
    return boot({
      MAIL_PROVIDER: "gmail",
      OWNER_TIMEZONE: "America/New_York",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret-do-not-log",
      GOOGLE_AUTH_URL: `${fake.apiBase}/o/oauth2/v2/auth`,
      GOOGLE_TOKEN_URL: fake.tokenUrl,
      GMAIL_API_BASE: fake.apiBase,
    }, { sql });
  }

  async function counts(sql: Sql): Promise<{ accounts: number; tokens: number }> {
    const accounts = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM accounts");
    const tokens = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM provider_tokens");
    return { accounts: Number(accounts.rows[0]?.n ?? 0), tokens: Number(tokens.rows[0]?.n ?? 0) };
  }

  it("refuses connect without a session, with a bad state, or without a refresh token", async () => {
    const fake = await FakeGmailServer.scripted();
    open.push(fake);
    const settings = env({
      MAIL_PROVIDER: "gmail",
      OWNER_TIMEZONE: "America/New_York",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret-do-not-log",
      GOOGLE_AUTH_URL: `${fake.apiBase}/o/oauth2/v2/auth`,
      GOOGLE_TOKEN_URL: fake.tokenUrl,
      GMAIL_API_BASE: fake.apiBase,
    });
    const sql = await openSql(loadConfig(settings));
    open.push({ close: () => sql.close() });
    const app = await createServer(settings, { sql });
    open.push(app);
    const bare = await https(app, "GET", "/connect/google");
    expect(bare.status).toBe(401);
    expect(fake.requests.some((item) => item.path.startsWith("/o/oauth2/v2/auth"))).toBe(false);
    expect(await counts(sql)).toEqual({ accounts: 0, tokens: 0 });
    const cookie = await signIn(app);
    const started = await https(app, "GET", "/connect/google", { cookie });
    expect(started.status).toBe(302);
    const authUrl = new URL(locationOf(started));
    expect(authUrl.searchParams.get("scope")).toBe(GOOGLE_SCOPES);
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("prompt")).toBe("consent");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const bad = await https(app, "GET", "/connect/google/callback?state=not-the-state&code=nope", { cookie });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("not valid");
    expect(await counts(sql)).toEqual({ accounts: 0, tokens: 0 });
    fake.issueRefresh = false;
    const again = await https(app, "GET", "/connect/google", { cookie });
    const google = await requestOnce("http", locationOf(again), undefined, "GET", {});
    expect(google.status).toBe(302);
    const callback = new URL(locationOf(google));
    const saved = await https(app, "GET", `${callback.pathname}${callback.search}`, { cookie });
    expect(saved.status).toBe(400);
    expect(saved.text).toContain("did not return a refresh token");
    expect(await counts(sql)).toEqual({ accounts: 0, tokens: 0 });
  });

  it("stores a sealed refresh token and disconnect removes the mail", async () => {
    const fake = await FakeGmailServer.scripted();
    open.push(fake);
    const app = await gmailApp(fake);
    const cookie = await signIn(app);
    const started = await https(app, "GET", "/connect/google", { cookie });
    const google = await requestOnce("http", locationOf(started), undefined, "GET", {});
    const callback = new URL(locationOf(google));
    const saved = await https(app, "GET", `${callback.pathname}${callback.search}`, { cookie });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.text).toContain("alex@riveralabs.example");
    const accounts = await app.store.listAccounts();
    expect(accounts).toHaveLength(1);
    const account = accounts[0]!;
    expect(account.email).toBe("alex@riveralabs.example");
    const sealed = await app.store.tokenCiphertext(account.id);
    expect(sealed).toBeTruthy();
    const token = JSON.parse(openSeal(app.config.encryptionKey, sealed ?? "")) as { refreshToken: string };
    expect(token.refreshToken).toBe(fake.connectRefresh);
    expect((await app.store.storedThreadIds(account.id)).size).toBe(0);
    expect((await app.store.getSyncState(account.id)).lastSyncAt).toBeNull();
    await app.store.saveThreadMeta(account.id, [{
      id: "t-local",
      snippet: "hi",
      messageCount: 1,
      viewUrl: "",
      historyId: null,
      messages: [{
        id: "m-local",
        threadId: "t-local",
        position: 0,
        sender: "a@example.com",
        toRecipients: [],
        ccRecipients: [],
        bccRecipients: [],
        replyTo: [],
        inReplyTo: "",
        references: "",
        subject: "hi",
        date: "2026-11-05T12:00:00.000Z",
        labelIds: [],
        snippet: "hi",
        plaintextBody: null,
        htmlBody: null,
        attachments: [],
        raw: null,
        viewUrl: "",
        bodyFetched: false,
      }],
    }]);
    const before = sealed;
    const second = await https(app, "GET", "/connect/google", { cookie });
    const secondUrl = new URL(locationOf(second));
    const replay = await https(app, "GET", `/connect/google/callback?code=${callback.searchParams.get("code")}&state=${secondUrl.searchParams.get("state")}`, { cookie });
    expect(replay.status).toBe(400);
    expect(replay.text).toContain("already used");
    expect(await app.store.tokenCiphertext(account.id)).toBe(before);
    const off = await https(app, "POST", "/connect/google/disconnect", {
      cookie,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(saved.text), account: account.id }).toString(),
    });
    expect(off.status, off.text).toBe(200);
    expect(await app.store.listAccounts()).toEqual([]);
    expect(await app.store.tokenCiphertext(account.id)).toBeNull();
    expect((await app.store.storedThreadIds(account.id)).size).toBe(0);
    const audit = await app.store.listAudit();
    expect(audit.map((row) => row.tool)).toEqual(["connect_google", "disconnect_google"]);
    expect(JSON.stringify(audit)).not.toContain(fake.connectRefresh);
  });
});

describe("redirect hosts and private addresses", () => {
  const hosts = ["claude.ai"];

  it("allows the Claude callback host and loopback outside production", () => {
    const callback = "https://claude.ai/api/mcp/auth_callback";
    expect(redirectAllowed(callback, "production", hosts)).toBe(true);
    expect(redirectAllowed("https://attacker.example/cb", "production", hosts)).toBe(false);
    expect(redirectAllowed("https://claude.ai.attacker.example/cb", "production", hosts)).toBe(false);
    expect(redirectAllowed("http://127.0.0.1:9/callback", "test", hosts)).toBe(true);
    expect(redirectAllowed("http://127.0.0.1:9/callback", "production", hosts)).toBe(false);
    expect(redirectAllowed("https://127.0.0.1/cb", "production", hosts)).toBe(false);
    expect(redirectAllowed("https://127.0.0.1/cb", "production", ["127.0.0.1"])).toBe(true);
    expect(redirectAllowed("http://localhost/callback", "test", hosts)).toBe(true);
  });

  it("treats 100.64.0.0/10 as private and applies fc, fd, and fe80 only to IPv6 literals", () => {
    expect(isPrivateHost("100.64.0.0")).toBe(true);
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("100.127.255.255")).toBe(true);
    expect(isPrivateHost("100.63.255.255")).toBe(false);
    expect(isPrivateHost("100.128.0.1")).toBe(false);
    expect(isPrivateHost("fd.example.com")).toBe(false);
    expect(isPrivateHost("fc.example.com")).toBe(false);
    expect(isPrivateHost("fe80.example.com")).toBe(false);
    expect(isPrivateHost("fd00::1")).toBe(true);
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("[fe80::1]")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("claude.ai")).toBe(false);
  });
});

describe("accounts and logs", () => {
  it("refuses a tool call for an account the owner did not connect", async () => {
    const app = await boot();
    const clientId = await cimd(REDIRECT);
    const allowed = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const issued = JSON.parse((await tokenFor(app, clientId, allowed.code)).text) as { access_token: string };
    await mcp(app, issued.access_token, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "cimd", version: "0" },
    });
    await mcp(app, issued.access_token, 2, "notifications/initialized");
    for (const token of [TOKEN, issued.access_token]) {
      const read = await mcp(app, token, 3, "tools/call", { name: "search_threads", arguments: { account: "not-connected", query: "" } });
      expect(read.status).toBe(200);
      expect(toolText(read).isError).toBe(true);
      expect(toolText(read).message).toBe("Unknown account.");
      const write = await mcp(app, token, 4, "tools/call", {
        name: "send_message",
        arguments: { account: "not-connected", to: "lee@example.com", subject: "hi", body: "hi" },
      });
      expect(write.status).toBe(200);
      expect(toolText(write).isError).toBe(true);
      expect(toolText(write).message).toBe("Unknown account.");
    }
  });

  it("keeps secrets out of the log and the audit log", async () => {
    const fake = await FakeGmailServer.scripted();
    open.push(fake);
    const app = await boot({
      MAIL_PROVIDER: "gmail",
      OWNER_TIMEZONE: "America/New_York",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret-do-not-log",
      GOOGLE_AUTH_URL: `${fake.apiBase}/o/oauth2/v2/auth`,
      GOOGLE_TOKEN_URL: fake.tokenUrl,
      GMAIL_API_BASE: fake.apiBase,
    });
    const lines: string[] = [];
    app.logger.setSink((line) => lines.push(line));
    const clientId = await cimd(REDIRECT);
    const page = await https(app, "GET", authorizeQuery(clientId, `${app.url}/mcp`));
    const cookie = cookieOf(page);
    await https(app, "POST", "/authorize", {
      cookie,
      type: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ csrf: csrfOf(page.text), passphrase: WRONG }).toString(),
    });
    const allowed = await allow(app, authorizeQuery(clientId, `${app.url}/mcp`));
    const issued = JSON.parse((await tokenFor(app, clientId, allowed.code)).text) as { access_token: string; refresh_token: string };
    const registered = await https(app, "POST", "/register", {
      type: "application/json",
      body: JSON.stringify({
        client_name: "Secret",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    const secret = (JSON.parse(registered.text) as { client_secret: string }).client_secret;
    const signed = await signIn(app);
    const started = await https(app, "GET", "/connect/google", { cookie: signed });
    const google = await requestOnce("http", locationOf(started), undefined, "GET", {});
    const callback = new URL(locationOf(google));
    await https(app, "GET", `${callback.pathname}${callback.search}`, { cookie: signed });
    const audit = JSON.stringify(await app.store.listAudit());
    const haystack = `${lines.join("\n")}\n${audit}`;
    for (const secretValue of [
      PASSPHRASE,
      WRONG,
      TOKEN,
      issued.access_token,
      issued.refresh_token,
      allowed.code,
      secret,
      fake.connectRefresh,
      fake.connectAccess,
      "google-client-secret-do-not-log",
    ]) {
      expect(haystack).not.toContain(secretValue);
    }
  });
});
