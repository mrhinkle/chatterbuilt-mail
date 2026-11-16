import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serverDir = join(root, "server");
const token = "smoke-owner-token-do-not-log-032";
const key = randomBytes(32).toString("base64");
const passphrase = "smoke-owner-passphrase";
const setupSecret = randomBytes(32).toString("base64url");
const setupPassphrase = `smoke-${randomBytes(9).toString("hex")}`;
let claimChild = null;
let claimOutput = "";
const { FakeMicrosoftServer } = await import(join(serverDir, "dist/src/providers/microsoft-fake-server.js"));
const { loadConfig } = await import(join(serverDir, "dist/src/config.js"));
const setupOwnerToken = loadConfig({ CBM_SECRET: setupSecret, NODE_ENV: "development" }).ownerToken;
const microsoft = await FakeMicrosoftServer.scripted();

function safe(text) {
  return String(text)
    .split(setupSecret).join("[setup-secret]")
    .split(setupPassphrase).join("[setup-passphrase]")
    .split(setupOwnerToken).join("[setup-token]")
    .split(token).join("[token]")
    .split(key).join("[key]");
}

const envServer = {
  ...process.env,
  MAIL_STORE: "pglite",
  MAIL_MODE: "mirror",
  MAIL_PROVIDER: "fake",
  NODE_ENV: "development",
  OWNER_TOKEN: token,
  OWNER_PASSPHRASE: passphrase,
  ENCRYPTION_KEY: key,
  HOST: "127.0.0.1",
  PORT: "0",
  CBM_SMOKE_IMAP: "1",
  MICROSOFT_CLIENT_ID: "smoke-microsoft-client",
  MICROSOFT_GRAPH_BASE: microsoft.graphBase,
  MICROSOFT_TOKEN_URL: microsoft.tokenUrl,
  MICROSOFT_AUTH_URL: microsoft.authUrl,
  MICROSOFT_DEVICE_URL: microsoft.deviceUrl,
};
delete envServer.GOOGLE_CLIENT_ID;
delete envServer.GOOGLE_CLIENT_SECRET;
delete envServer.CBM_SECRET;

const child = spawn("npm", ["run", "dev"], {
  cwd: serverDir,
  env: envServer,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function killGroup(proc) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try { proc.kill("SIGTERM"); } catch { /* already gone */ }
  }
  setTimeout(() => {
    try { process.kill(-proc.pid, "SIGKILL"); } catch { /* already gone */ }
  }, 1500).unref();
}

function stop() {
  microsoft.close().catch(() => {});
  killGroup(child);
  killGroup(claimChild);
}

function fail(message) {
  if (finished) return;
  finished = true;
  console.error(safe(message));
  if (output) console.error(safe(output.slice(-4000)));
  if (claimOutput) console.error(safe(claimOutput.slice(-4000)));
  stop();
  process.exit(1);
}

function parseBody(text) {
  if (!text) return null;
  if (text.startsWith("event:") || text.startsWith("data:") || text.includes("\ndata:")) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]);
  }
  return JSON.parse(text);
}

function httpCall(method, url, ca, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body == null ? null : Buffer.from(body);
    const req = httpsRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        ...headers,
        ...(payload ? { "content-length": String(payload.length) } : {}),
      },
      ca,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          text: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        });
      });
    });
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function postJson(url, ca, headers, body) {
  return httpCall("POST", url, ca, headers, body);
}

function getJson(url, ca) {
  return httpCall("GET", url, ca, { accept: "application/json" }, null);
}

async function rpc(url, body, ca, bearer = token) {
  const res = await postJson(`${url}/mcp`, ca, {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }, JSON.stringify(body));
  if (res.text.includes(token) || res.text.includes(setupOwnerToken)) fail("MCP response contained an owner token");
  if (res.text.includes(setupSecret) || res.text.includes(setupPassphrase)) fail("MCP response contained the setup secret");
  if (res.status < 200 || res.status >= 300) fail(`MCP ${body.method} returned ${res.status}: ${res.text.slice(0, 500)}`);
  return parseBody(res.text);
}

const timer = setTimeout(() => fail("dev server did not print a listening line"), 45000);

let listening = false;
let finished = false;
child.on("exit", (code) => {
  if (finished) return;
  fail(listening
    ? `dev server exited during the smoke (code ${code})`
    : `dev server exited before listening (code ${code})`);
});

const ready = await new Promise((resolve) => {
  const look = () => {
    const match = /listening https:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    const trust = /trust-file (\S+)/.exec(output);
    if (match && trust) {
      listening = true;
      resolve({ url: `https://127.0.0.1:${match[1]}`, certPath: trust[1] });
    }
  };
  child.stdout.on("data", look);
  child.stderr.on("data", look);
  look();
});
clearTimeout(timer);
const url = ready.url;
const ca = readFileSync(ready.certPath);

const protectedDoc = await getJson(`${url}/.well-known/oauth-protected-resource`, ca);
if (protectedDoc.status !== 200) fail(`protected resource metadata returned ${protectedDoc.status}`);
const protectedBody = JSON.parse(protectedDoc.text);
if (!String(protectedBody.resource ?? "").endsWith("/mcp")) fail("protected resource metadata has no /mcp resource");
if (!Array.isArray(protectedBody.authorization_servers) || protectedBody.authorization_servers.length === 0) {
  fail("protected resource metadata has no authorization server");
}

const authDoc = await getJson(`${url}/.well-known/oauth-authorization-server`, ca);
if (authDoc.status !== 200) fail(`authorization server metadata returned ${authDoc.status}`);
const authBody = JSON.parse(authDoc.text);
if (!authBody.authorization_endpoint) fail("authorization server metadata has no authorization endpoint");
if (authBody.client_id_metadata_document_supported !== true) {
  fail("authorization server metadata does not advertise client id metadata documents");
}

const openMcp = await postJson(`${url}/mcp`, ca, {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
}, "{}");
if (openMcp.status !== 401) fail(`unauthenticated /mcp returned ${openMcp.status}`);
const www = String(openMcp.headers["www-authenticate"] ?? "");
if (!www.includes('resource_metadata="') || !www.includes("/.well-known/oauth-protected-resource")) {
  fail("unauthenticated /mcp did not advertise resource_metadata");
}

const hello = await rpc(url, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
}, ca);
if (!hello?.result?.protocolVersion) fail(`initialize did not return a protocol version: ${JSON.stringify(hello)}`);

const noted = await postJson(`${url}/mcp`, ca, {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
}, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
if (noted.status !== 200 && noted.status !== 202) fail(`initialized notification returned ${noted.status}`);

const listed = await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, ca);
const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
if (!names.includes("search_threads") || !names.includes("get_thread") || !names.includes("sync_now")) {
  fail(`tools/list missing read tools: ${names.join(", ")}`);
}

const search = await rpc(url, {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "search_threads", arguments: { query: "" } },
}, ca);
const searchText = search?.result?.content?.[0]?.text ?? "";
const searchData = searchText ? JSON.parse(searchText) : {};
const threadIds = (searchData.threads ?? []).map((thread) => thread.id);
if (search?.result?.isError || !threadIds.includes("t1")) fail("search_threads did not return t1");

const thread = await rpc(url, {
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "get_thread", arguments: { threadId: "t1" } },
}, ca);
const threadText = thread?.result?.content?.[0]?.text ?? "";
const threadData = threadText ? JSON.parse(threadText) : {};
if (thread?.result?.isError || threadData.id !== "t1" || !threadData.messages?.length) {
  fail("get_thread did not return t1");
}

if (!names.includes("create_draft") || !names.includes("get_draft") || !names.includes("delete_draft")) {
  fail(`tools/list missing draft tools: ${names.join(", ")}`);
}

const created = await rpc(url, {
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: {
    name: "create_draft",
    arguments: { to: "lee@example.com", subject: "smoke draft", body: "hello from smoke" },
  },
}, ca);
const createdText = created?.result?.content?.[0]?.text ?? "";
const createdData = createdText ? JSON.parse(createdText) : {};
if (created?.result?.isError || !createdData.id) fail("create_draft did not return an id");

const draft = await rpc(url, {
  jsonrpc: "2.0",
  id: 6,
  method: "tools/call",
  params: { name: "get_draft", arguments: { draftId: createdData.id } },
}, ca);
const draftText = draft?.result?.content?.[0]?.text ?? "";
const draftData = draftText ? JSON.parse(draftText) : {};
if (draft?.result?.isError || draftData.id !== createdData.id) fail("get_draft did not return the new draft");

const removed = await rpc(url, {
  jsonrpc: "2.0",
  id: 7,
  method: "tools/call",
  params: { name: "delete_draft", arguments: { draftId: createdData.id } },
}, ca);
if (removed?.result?.isError) fail("delete_draft failed");

const gone = await rpc(url, {
  jsonrpc: "2.0",
  id: 8,
  method: "tools/call",
  params: { name: "get_draft", arguments: { draftId: createdData.id } },
}, ca);
if (!gone?.result?.isError) fail("delete_draft left the draft");

const synced = await rpc(url, {
  jsonrpc: "2.0",
  id: 9,
  method: "tools/call",
  params: { name: "sync_now", arguments: {} },
}, ca);
const syncedText = synced?.result?.content?.[0]?.text ?? "";
const syncedData = syncedText ? JSON.parse(syncedText) : {};
const work = (syncedData.accounts ?? []).find((row) => row.account === "gmail_work");
if (synced?.result?.isError || work?.synced !== true) fail(`sync_now did not sync gmail_work: ${syncedText}`);

function cookieFrom(headers) {
  const value = headers["set-cookie"];
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  const line = lines.find((item) => item.startsWith("cbm_owner="));
  const match = /cbm_owner=([^;]+)/.exec(line ?? "");
  return match?.[1] ? `cbm_owner=${match[1]}` : "";
}

function csrfFrom(html) {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  return match?.[1] ?? "";
}

const signPage = await httpCall("GET", `${url}/signin`, ca, { accept: "text/html" }, null);
const signCookie = cookieFrom(signPage.headers);
const signCsrf = csrfFrom(signPage.text);
if (signPage.status !== 200 || !signCookie || !signCsrf) fail(`sign-in page was not ready: ${signPage.status}`);
const signed = await httpCall("POST", `${url}/signin`, ca, {
  cookie: signCookie,
  "content-type": "application/x-www-form-urlencoded",
  accept: "text/html",
}, new URLSearchParams({ csrf: signCsrf, passphrase }).toString());
const session = cookieFrom(signed.headers);
if (signed.status !== 200 || !session) fail(`sign-in returned ${signed.status}`);
const connectPage = await httpCall("GET", `${url}/connect/microsoft`, ca, { cookie: session, accept: "text/html" }, null);
const connectCsrf = csrfFrom(connectPage.text);
if (connectPage.status !== 200 || !connectCsrf) fail(`connect page returned ${connectPage.status}`);
const started = await httpCall("POST", `${url}/connect/microsoft`, ca, {
  cookie: session,
  "content-type": "application/x-www-form-urlencoded",
  accept: "text/html",
}, new URLSearchParams({ csrf: connectCsrf }).toString());
if (started.status !== 200 || !started.text.includes("ABCD-EFGH")) fail(`device start returned ${started.status}`);
if (!started.text.includes("Open microsoft.com/devicelogin, type this code, and sign in. This page finishes by itself.")) {
  fail("device page is missing the sign-in sentence");
}
if (started.text.includes(microsoft.issuedDeviceCode)) fail("device page contained the device code");
const deviceRequest = microsoft.recorded().find((row) => row.path.startsWith("/common/oauth2/v2.0/devicecode"));
if (!deviceRequest || deviceRequest.body.includes("client_secret")) fail("device-code request sent a client secret");
const status = await httpCall("GET", `${url}/connect/microsoft/device/status`, ca, {
  cookie: session,
  accept: "application/json",
}, null);
const statusBody = status.text ? JSON.parse(status.text) : {};
if (status.status !== 200 || statusBody.status !== "done") fail(`device status was ${status.status} ${status.text.slice(0, 300)}`);
if (output.includes(microsoft.issuedDeviceCode)) fail("dev server logged the device code");

const accountsCall = await rpc(url, {
  jsonrpc: "2.0",
  id: 10,
  method: "tools/call",
  params: { name: "list_accounts", arguments: {} },
}, ca);
const accountsText = accountsCall?.result?.content?.[0]?.text ?? "";
const accountsData = accountsText ? JSON.parse(accountsText) : {};
const smokeAccounts = accountsData.accounts ?? [];
if (accountsCall?.result?.isError || smokeAccounts.length === 0) fail(`list_accounts returned no accounts: ${accountsText}`);
const ids = smokeAccounts.map((account) => account.id);
if (!ids.includes("gmail_work") || !ids.includes("gmail_personal")) fail(`list_accounts dropped a demo account: ${ids.join(", ")}`);
if (!smokeAccounts.some((account) => account.kind === "microsoft" && account.email === "owner@outlook.example")) {
  fail(`list_accounts has no microsoft account: ${accountsText}`);
}
for (const account of smokeAccounts) {
  const caps = account.capabilities;
  if (!account.kind || !caps || typeof caps.filters !== "boolean" || typeof caps.sendAs !== "boolean" || (caps.labels !== "labels" && caps.labels !== "folders")) {
    fail(`list_accounts is missing kind or capabilities: ${JSON.stringify(account)}`);
  }
  if (account.kind === "gmail" && (caps.filters !== true || caps.sendAs !== true || caps.labels !== "labels")) {
    fail(`list_accounts gmail capabilities are wrong: ${JSON.stringify(account)}`);
  }
  if (account.kind === "imap" && (caps.filters !== false || caps.sendAs !== true || caps.labels !== "folders")) {
    fail(`list_accounts imap capabilities are wrong: ${JSON.stringify(account)}`);
  }
}
if (!smokeAccounts.some((account) => account.kind === "imap")) {
  fail(`list_accounts has no IMAP account: ${accountsText}`);
}
if (output.includes(token)) fail("dev server logged the owner token");

function toolJson(call) {
  const text = call?.result?.content?.[0]?.text ?? "";
  return { text, data: text ? JSON.parse(text) : {} };
}

function assertServerInfo(call, expected, label) {
  if (call?.result?.isError) fail(`${label} server_info returned an error`);
  const { text, data } = toolJson(call);
  if (typeof data.publicUrl !== "string" || typeof data.version !== "string") {
    fail(`${label} server_info was missing publicUrl or version`);
  }
  const providers = data.providers ?? {};
  if (providers.google !== expected.google || providers.microsoft !== expected.microsoft || providers.imap !== expected.imap) {
    fail(`${label} server_info providers were ${JSON.stringify(providers)}`);
  }
  if (/secret/i.test(text) || text.includes(setupSecret) || text.includes(setupPassphrase) || text.includes(key) || text.includes(token) || text.includes(setupOwnerToken)) {
    fail(`${label} server_info leaked`);
  }
  return data;
}

const envInfo = await rpc(url, {
  jsonrpc: "2.0",
  id: 11,
  method: "tools/call",
  params: { name: "server_info", arguments: {} },
}, ca);
assertServerInfo(envInfo, { google: false, microsoft: true, imap: false }, "env");

function claimEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      name === "OWNER_PASSPHRASE"
      || name === "OWNER_TOKEN"
      || name === "ENCRYPTION_KEY"
      || name === "CBM_SECRET"
      || name.startsWith("GOOGLE_")
      || name.startsWith("MICROSOFT_")
    ) delete env[name];
  }
  env.CBM_SECRET = setupSecret;
  env.MAIL_STORE = "pglite";
  env.MAIL_PROVIDER = "fake";
  env.NODE_ENV = "development";
  env.HOST = "127.0.0.1";
  env.PORT = "0";
  return env;
}

claimChild = spawn("npm", ["run", "dev"], {
  cwd: serverDir,
  env: claimEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
claimChild.stdout.on("data", (chunk) => {
  claimOutput += chunk.toString();
});
claimChild.stderr.on("data", (chunk) => {
  claimOutput += chunk.toString();
});
let claimListening = false;
claimChild.on("exit", (code) => {
  if (finished || claimListening === "done") return;
  fail(claimListening
    ? `setup server exited during the smoke (code ${code})`
    : `setup server exited before listening (code ${code})`);
});
const claimTimer = setTimeout(() => fail("setup server did not print a listening line"), 45000);
const claimReady = await new Promise((resolve) => {
  const look = () => {
    const match = /listening https:\/\/127\.0\.0\.1:(\d+)/.exec(claimOutput);
    const trust = /trust-file (\S+)/.exec(claimOutput);
    if (match && trust) {
      claimListening = true;
      resolve({ url: `https://127.0.0.1:${match[1]}`, certPath: trust[1] });
    }
  };
  claimChild.stdout.on("data", look);
  claimChild.stderr.on("data", look);
  look();
});
clearTimeout(claimTimer);
const claimUrl = claimReady.url;
const claimCa = readFileSync(claimReady.certPath);

const setupPage = await httpCall("GET", `${claimUrl}/setup`, claimCa, { accept: "text/html" }, null);
const setupCookie = cookieFrom(setupPage.headers);
const setupCsrf = csrfFrom(setupPage.text);
if (setupPage.status !== 200 || !setupPage.text.includes("At least 12 characters") || !setupCookie || !setupCsrf) {
  fail(`setup page was not ready: ${setupPage.status}`);
}
if (setupPage.text.includes(setupSecret) || setupPage.text.includes(setupPassphrase)) fail("setup page echoed a secret");

const claimed = await httpCall("POST", `${claimUrl}/setup`, claimCa, {
  cookie: setupCookie,
  "content-type": "application/x-www-form-urlencoded",
  accept: "text/html",
}, new URLSearchParams({ csrf: setupCsrf, secret: setupSecret, passphrase: setupPassphrase, confirm: setupPassphrase }).toString(), 60000);
const claimLocation = claimed.headers.location;
const claimWhere = Array.isArray(claimLocation) ? claimLocation[0] : claimLocation;
if (claimed.status !== 302 || claimWhere !== "/connect") fail(`setup claim returned ${claimed.status} ${String(claimWhere)}`);
if (claimed.text.includes(setupSecret) || claimed.text.includes(setupPassphrase)) fail("setup claim echoed a secret");

const closed = await httpCall("GET", `${claimUrl}/setup`, claimCa, { accept: "text/html" }, null);
if (closed.status !== 404) fail(`setup after claim returned ${closed.status}`);
if (closed.text.includes(setupSecret) || closed.text.includes(setupPassphrase)) fail("closed setup echoed a secret");

const claimHello = await rpc(claimUrl, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-setup", version: "0" },
  },
}, claimCa, setupOwnerToken);
if (!claimHello?.result?.protocolVersion) fail("setup server initialize failed");
const claimNoted = await postJson(`${claimUrl}/mcp`, claimCa, {
  authorization: `Bearer ${setupOwnerToken}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
}, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
if (claimNoted.status !== 200 && claimNoted.status !== 202) fail(`setup server initialized notification returned ${claimNoted.status}`);
if (claimNoted.text.includes(setupSecret) || claimNoted.text.includes(setupPassphrase) || claimNoted.text.includes(setupOwnerToken)) {
  fail("setup server MCP response leaked");
}

const claimInfo = await rpc(claimUrl, {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "server_info", arguments: {} },
}, claimCa, setupOwnerToken);
assertServerInfo(claimInfo, { google: false, microsoft: false, imap: false }, "claim");

if (claimOutput.includes(setupSecret) || claimOutput.includes(setupPassphrase) || /secret/i.test(claimOutput)) {
  fail("setup server log leaked");
}
claimListening = "done";

finished = true;
console.log("smoke ok");
console.log(`initialize ${hello.result.protocolVersion}`);
console.log(`tools ${names.length}`);
console.log("sync_now gmail_work synced");
console.log(`list_accounts ${smokeAccounts.length} with kind and capabilities`);
console.log(`search_threads ${threadIds.length}`);
console.log("get_thread t1");
console.log(`create_draft ${createdData.id}`);
console.log("get_draft ok");
console.log("delete_draft ok");
console.log("server_info env microsoft");
console.log("setup claimed");
console.log("server_info claim providers false");
stop();
setTimeout(() => process.exit(0), 500);
