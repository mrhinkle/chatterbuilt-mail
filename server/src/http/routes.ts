import type { IncomingMessage, ServerResponse } from "node:http";
import { bearerMatches, bearerValue } from "../auth.js";
import type { Config } from "../config.js";
import type { Logger } from "../log.js";
import { PushAuthError, verifyPushToken } from "../push/oidc.js";
import type { Repo } from "../store/repo.js";
import type { JobService } from "../sync/jobs.js";
import type { SyncService } from "../sync/service.js";
import { requestPath } from "./path.js";

const BODY_CAP = 1_048_576;

export interface RouteDeps {
  config: Config;
  store: Repo;
  sync: SyncService;
  jobs: JobService;
  logger: Logger;
}

/** Cron and push, before the owner-token check on /mcp. Returns false when the path is not one of these. */
export async function routeHttp(req: IncomingMessage, res: ServerResponse, deps: RouteDeps): Promise<boolean> {
  const path = requestPath(req);
  if (path === "/api/cron/sync") {
    await cron(req, res, deps, "sync");
    return true;
  }
  if (path === "/api/cron/jobs") {
    await cron(req, res, deps, "jobs");
    return true;
  }
  if (path === "/api/gmail/push") {
    await push(req, res, deps);
    return true;
  }
  return false;
}

async function cron(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RouteDeps,
  kind: "sync" | "jobs",
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!deps.config.cronSecret) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const header = req.headers.authorization;
  const presented = Array.isArray(header) ? header[0] : header;
  if (!bearerMatches(presented, deps.config.cronSecret)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (kind === "jobs") {
      const woke = await deps.jobs.runDue(undefined, () => false);
      sendJson(res, 200, { ok: true, woke });
      return;
    }
    await deps.jobs.runDue(undefined, () => false);
    const synced = await deps.sync.syncNow();
    sendJson(res, 200, { ok: true, accounts: synced.accounts });
  } catch (error) {
    deps.logger.info("cron failed", { name: error instanceof Error ? error.name : "Error" });
    sendJson(res, 500, { error: "upstream_error" });
  }
}

async function push(req: IncomingMessage, res: ServerResponse, deps: RouteDeps): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const audience = deps.config.gmailPushAudience;
  const serviceAccount = deps.config.gmailPushServiceAccount;
  if (!audience || !serviceAccount) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const header = req.headers.authorization;
  const presented = Array.isArray(header) ? header[0] : header;
  const token = bearerValue(presented);
  try {
    await verifyPushToken(token, {
      audience,
      serviceAccount,
      jwksJson: deps.config.gmailPushJwks,
      nodeEnv: deps.config.nodeEnv,
      timeoutMs: deps.config.gmailTimeoutMs,
    });
  } catch (error) {
    if (!(error instanceof PushAuthError)) {
      deps.logger.info("push rejected", { name: error instanceof Error ? error.name : "Error" });
    }
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const body = await readBody(req, BODY_CAP);
  if (body === null) {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }
  const notice = pushNotice(parsed);
  if (!notice) {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }
  const accounts = await deps.store.listAccounts();
  const account = accounts.find((item) => item.email.toLowerCase() === notice.email.toLowerCase());
  if (!account) {
    sendJson(res, 200, { ok: true, matched: false });
    return;
  }
  try {
    await deps.jobs.runDue(account.id, () => false);
    await deps.sync.syncAccount(account.id, deps.config.syncBudgetMs);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    deps.logger.info("push failed", { account: account.id, name: error instanceof Error ? error.name : "Error" });
    res.statusCode = 204;
    res.end();
  }
}

function pushNotice(value: unknown): { email: string; historyId: string } | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as { message?: { data?: unknown } }).message;
  if (!message || typeof message.data !== "string" || !message.data) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(message.data, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let inner: unknown;
  try {
    inner = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!inner || typeof inner !== "object") return null;
  const email = (inner as { emailAddress?: unknown }).emailAddress;
  const historyId = (inner as { historyId?: unknown }).historyId;
  if (typeof email !== "string" || !email) return null;
  if (typeof historyId !== "string" && typeof historyId !== "number") return null;
  return { email, historyId: String(historyId) };
}

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > max) {
    req.resume();
    return Promise.resolve(null);
  }
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
      if (total > max) {
        finish(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(total > max ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
