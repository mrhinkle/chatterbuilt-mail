import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secretEqual } from "../auth.js";
import type { MailAuth } from "../auth/service.js";
import type { Config } from "../config.js";
import { ToolError } from "../errors.js";
import { capabilitiesFor } from "../providers/capabilities.js";
import type { Logger } from "../log.js";
import type { ToolRegistry } from "../mcp/register.js";
import type { Repo } from "../store/repo.js";
import { requestPath } from "./path.js";
import { completeSample, SampleError } from "./sample.js";

/** The page's hosted connector name. Anything else is not proxied. */
export const HOSTED_SERVER = "Chatterbuilt Mail";
const CSRF_HEADER = "x-cbm-csrf";
const ACCOUNTS_MARKER = "[] /* CBM_ACCOUNTS */";
const CALL_BODY_CAP = 1_048_576;
const SAMPLE_BODY_CAP = 48 * 1024;
const SAMPLE_PROMPT_MAX = 24_000;
const SAMPLE_LIMIT = 30;
const SAMPLE_WINDOW_MS = 10 * 60 * 1000;

function pageNonce(): string {
  return randomBytes(16).toString("base64url");
}

function pageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src blob: https://cdnjs.cloudflare.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface AppDeps {
  config: Config;
  logger: Logger;
  store: Repo;
  auth: MailAuth;
  registry: ToolRegistry;
  now?: () => number;
}

export async function handleApp(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<boolean> {
  const path = requestPath(req);
  if (path !== "/app" && !path.startsWith("/app/")) return false;
  try {
    if (path === "/app") await servePage(req, res, deps);
    else if (path === "/app/manifest.webmanifest") await serveManifest(req, res, deps);
    else if (path === "/app/icon.svg") await serveIcon(req, res, deps);
    else if (path === "/app/api/call") await serveCall(req, res, deps);
    else if (path === "/app/api/sample") await serveSample(req, res, deps);
    else if (path.startsWith("/app/api/")) await refuseApi(req, res, deps);
    else await refusePage(req, res, deps);
  } catch (error) {
    deps.logger.info("app failed", { name: error instanceof Error ? error.name : "Error" });
    if (!res.headersSent) sendJson(res, 500, { code: "tool_error", message: "The page failed." });
  }
  return true;
}

async function servePage(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const session = await deps.auth.ownerSession(req);
  if (!session) {
    redirect(res, "/signin?next=/app");
    return;
  }
  const accounts = (await deps.store.listAccounts()).map((account) => ({
    id: account.id,
    email: account.email,
    label: account.label,
    color: account.color || "blue",
    kind: account.kind,
    capabilities: capabilitiesFor(account.kind),
  }));
  const fragment = pageFragment().split(ACCOUNTS_MARKER).join(`${scriptJson(accounts)} /* CBM_ACCOUNTS */`);
  const nonce = pageNonce();
  const html = documentFor(
    fragment,
    session.csrf,
    Boolean(deps.config.anthropicApiKey || deps.config.openrouterApiKey),
    nonce,
  );
  sendHtml(res, html, req.method === "HEAD", nonce);
}

async function serveManifest(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!await deps.auth.ownerSession(req)) {
    redirect(res, "/signin?next=/app");
    return;
  }
  const body = JSON.stringify({
    name: "Chatterbuilt Mail",
    short_name: "Mail",
    start_url: "/app",
    scope: "/app",
    display: "standalone",
    background_color: "#f3f5f9",
    theme_color: "#2563eb",
    icons: [{ src: "/app/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  });
  res.statusCode = 200;
  res.setHeader("content-type", "application/manifest+json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  if (req.method !== "HEAD") res.end(body);
  else res.end();
}

async function serveIcon(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!await deps.auth.ownerSession(req)) {
    redirect(res, "/signin?next=/app");
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "image/svg+xml");
  res.setHeader("cache-control", "public, max-age=86400");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  if (req.method !== "HEAD") res.end(iconSvg());
  else res.end();
}

async function refusePage(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (!await deps.auth.ownerSession(req)) {
    redirect(res, "/signin?next=/app");
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

async function refuseApi(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method === "OPTIONS") {
    noStore(res, 204);
    res.end();
    return;
  }
  if (!await deps.auth.ownerSession(req)) {
    req.resume();
    sendJson(res, 401, { code: "unauthorized", message: "Sign in." });
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

async function serveCall(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method === "OPTIONS") {
    noStore(res, 204);
    res.end();
    return;
  }
  const session = await deps.auth.ownerSession(req);
  if (!session) {
    req.resume();
    sendJson(res, 401, { code: "unauthorized", message: "Sign in." });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!csrfOk(req, session.csrf)) {
    req.resume();
    sendJson(res, 403, { code: "tool_error", message: "This page has expired. Reload it." });
    return;
  }
  const raw = await readBody(req, CALL_BODY_CAP);
  if (raw === null) {
    sendJson(res, 413, { code: "tool_error", message: "That request is too large." });
    return;
  }
  const parsed = parseObject(raw);
  if (!parsed) {
    sendJson(res, 400, { code: "tool_error", message: "The request could not be read." });
    return;
  }
  const named = typeof parsed.server === "string" ? parsed.server : HOSTED_SERVER;
  if (named !== HOSTED_SERVER) {
    sendJson(res, 400, {
      code: "server_not_connected",
      message: "That connector isn't available outside Claude. Only this mailbox is connected here.",
      retryable: false,
    });
    return;
  }
  const tool = typeof parsed.tool === "string" ? parsed.tool : "";
  const input = parsed.input && typeof parsed.input === "object" ? parsed.input : {};
  try {
    const payload = await deps.registry.call(tool, input);
    deps.logger.info("app tool", { tool });
    sendJson(res, 200, { payload });
  } catch (error) {
    const coded = error instanceof ToolError ? error : new ToolError("tool_error", "The tool failed.");
    deps.logger.info("app tool failed", { tool, code: coded.code });
    const body: Record<string, unknown> = { code: coded.code, message: coded.message };
    if (deps.registry.isWrite(tool)) body.retryable = false;
    else if (coded.retryable) body.retryable = true;
    sendJson(res, statusFor(coded.code), body);
  }
}

async function serveSample(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  if (req.method === "OPTIONS") {
    noStore(res, 204);
    res.end();
    return;
  }
  const session = await deps.auth.ownerSession(req);
  if (!session) {
    req.resume();
    sendJson(res, 401, { code: "unauthorized", message: "Sign in." });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!csrfOk(req, session.csrf)) {
    req.resume();
    sendJson(res, 403, { code: "tool_error", message: "This page has expired. Reload it." });
    return;
  }
  const raw = await readBody(req, SAMPLE_BODY_CAP);
  if (raw === null) {
    sendJson(res, 413, { code: "tool_error", message: "That request is too large." });
    return;
  }
  const parsed = parseObject(raw);
  const prompt = parsed && typeof parsed.prompt === "string" ? parsed.prompt : "";
  if (!parsed || prompt.length > SAMPLE_PROMPT_MAX) {
    sendJson(res, prompt.length > SAMPLE_PROMPT_MAX ? 413 : 400, {
      code: "tool_error",
      message: prompt.length > SAMPLE_PROMPT_MAX ? "That request is too large." : "The request could not be read.",
    });
    return;
  }
  if (!deps.config.anthropicApiKey && !deps.config.openrouterApiKey) {
    sendJson(res, 200, { text: null });
    return;
  }
  const allowed = await deps.auth.allowSample(
    session.hash,
    deps.now ? deps.now() : Date.now(),
    SAMPLE_WINDOW_MS,
    SAMPLE_LIMIT,
  );
  if (!allowed) {
    sendJson(res, 429, { code: "rate_limited", message: "Too many model calls. Wait a few minutes.", retryable: true });
    return;
  }
  try {
    const text = await completeSample(deps.config, prompt);
    deps.logger.info("sample", { provider: deps.config.anthropicApiKey ? "anthropic" : "openrouter" });
    sendJson(res, 200, { text: text ?? "" });
  } catch (error) {
    if (error instanceof SampleError) {
      deps.logger.info("sample failed", { code: error.code });
      sendJson(res, 502, { code: error.code, message: error.message, retryable: true });
      return;
    }
    throw error;
  }
}

function csrfOk(req: IncomingMessage, csrf: string): boolean {
  const header = req.headers[CSRF_HEADER];
  const presented = Array.isArray(header) ? header[0] ?? "" : header ?? "";
  if (!presented) return false;
  return secretEqual(presented, csrf);
}

function statusFor(code: string): number {
  if (code === "needs_reauth") return 401;
  if (code === "rate_limited") return 429;
  if (code === "upstream_error") return 502;
  return 400;
}

function documentFor(fragment: string, csrf: string, sample: boolean, nonce: string): string {
  const boot = scriptJson({ csrf, server: HOSTED_SERVER, sample });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2563eb">
<meta name="referrer" content="no-referrer">
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="icon" href="/app/icon.svg" type="image/svg+xml">
<script nonce="${nonce}">${shim(boot)}</script>
</head>
<body>
${stampPageScript(fragment, nonce)}
</body>
</html>`;
}

function stampPageScript(fragment: string, nonce: string): string {
  const open = "<script>";
  const at = fragment.indexOf(open);
  if (at < 0) throw new Error("The page script is missing.");
  return `${fragment.slice(0, at)}<script nonce="${nonce}">${fragment.slice(at + open.length)}`;
}

function shim(boot: string): string {
  return `window.__cbm=${boot};window.__cbmStandalone=true;` +
    `window.claude={use:function(name){` +
    `if(name==="mcp")return Promise.resolve(window.__cbmMcp);` +
    `if(name==="sample")return Promise.resolve(window.__cbm.sample?window.__cbmSample:null);` +
    `if(name==="downloads")return Promise.resolve(window.__cbmDownloads);` +
    `return Promise.resolve(null);}};` +
    `window.__cbmMcp={` +
    `listTools:function(){return Promise.resolve({servers:[{server:window.__cbm.server,authStatus:"ok"}]});},` +
    `callTool:function(server,tool,input){` +
    `if(server!==window.__cbm.server)return Promise.reject({code:"server_not_connected",message:String(server)+" isn't available outside Claude. Only this mailbox is connected here.",retryable:false});` +
    `return fetch("/app/api/call",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-cbm-csrf":window.__cbm.csrf},body:JSON.stringify({server:server,tool:tool,input:input||{}})})` +
    `.then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{};}catch(e){body={code:"upstream_error",message:"The server sent a response the page could not read.",retryable:true};}` +
    `if(!res.ok){var err={code:body.code||"tool_error",message:body.message||"The tool failed.",retryable:body.retryable===true};if(body.retryAfterMs)err.retryAfterMs=body.retryAfterMs;throw err;}` +
    `return {payload:body.payload};});});},` +
    `invalidate:function(){return Promise.resolve();}};` +
    `window.__cbmSample=function(prompt,opts){return fetch("/app/api/sample",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-cbm-csrf":window.__cbm.csrf},body:JSON.stringify({prompt:String(prompt||"")}),signal:opts&&opts.signal})` +
    `.then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{};}catch(e){body={code:"upstream_error",message:"The model did not answer.",retryable:true};}` +
    `if(!res.ok||body.text==null){var err={code:body.code||"upstream_error",message:body.message||"The model did not answer.",retryable:body.retryable===true};throw err;}` +
    `return {text:String(body.text)};});});};` +
    `window.__cbmDownloads={save:function(file){var name=(file&&file.filename)||"download";var data=file&&file.data;var blob=data instanceof Blob?data:new Blob([data==null?"":data]);var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);return Promise.resolve();}};`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

let cachedFragment: string | null = null;
let cachedIcon: string | null = null;

function pageFragment(): string {
  if (cachedFragment) return cachedFragment;
  const found = readAsset("page.html");
  if (!found) throw new Error("The page has not been built. Run npm run build in server/.");
  cachedFragment = found;
  return found;
}

function iconSvg(): string {
  if (cachedIcon) return cachedIcon;
  const found = readAsset("icon.svg") ?? readRepoIcon();
  if (!found) throw new Error("The app icon is missing. Run npm run build in server/.");
  cachedIcon = found;
  return found;
}

function readAsset(name: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../app", name),
    join(here, "../../../app", name),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

function readRepoIcon(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../docs/images/chatterbuilt-mail-mark.svg"),
    join(here, "../../../../docs/images/chatterbuilt-mail-mark.svg"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage, cap: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        finish(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendHtml(res: ServerResponse, html: string, head: boolean, nonce: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-security-policy", pageCsp(nonce));
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-frame-options", "DENY");
  if (head) res.end();
  else res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  noStore(res, status);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function noStore(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.end();
}
