import type { IncomingMessage } from "node:http";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { Config } from "../config.js";

export const MAIL_SCOPE = "mail";
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
export const PASSPHRASE_WINDOW_MS = 15 * 60 * 1000;
export const PASSPHRASE_IP_LIMIT = 5;
export const PASSPHRASE_GLOBAL_LIMIT = 10;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_PER_HOUR = 20;
export const REGISTER_TOTAL = 100;
export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 65_536;

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

/** Delegated Graph scopes for both sign-in modes. Nothing else. */
export const MICROSOFT_SCOPES = "offline_access openid email User.Read Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite";

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function headerValue(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function safeHost(value: string): string | null {
  const host = value.trim();
  if (!host || host.length > 255 || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return null;
  return host;
}

/** Origin the tokens are bound to. PUBLIC_URL wins. Otherwise the request host. */
export function publicOrigin(req: IncomingMessage, config: Config): string {
  if (config.publicUrl) return config.publicUrl;
  if (config.trustProxy) {
    const host = safeHost(headerValue(req, "x-forwarded-host").split(",")[0]?.trim() ?? "");
    if (host) {
      const proto = headerValue(req, "x-forwarded-proto").split(",")[0]?.trim() || "https";
      if (proto !== "https" && proto !== "http") throw new Error("host");
      return `${proto}://${host}`;
    }
  }
  const host = safeHost(headerValue(req, "host"));
  if (!host) throw new Error("host");
  return `https://${host}`;
}

/** Canonical MCP resource. No fragment, no trailing slash. */
export function canonicalResource(origin: string): string {
  const url = resourceUrlFromServerUrl(`${origin}/mcp`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.origin}${path}`;
}

export function metadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function sameResource(left: string, right: string): boolean {
  try {
    const a = resourceUrlFromServerUrl(left);
    const b = resourceUrlFromServerUrl(right);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
    return a.origin === b.origin && path(a) === path(b) && a.search === b.search;
  } catch {
    return false;
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const first = headerValue(req, "x-forwarded-for").split(",")[0]?.trim() ?? "";
    if (first) return first.slice(0, 80);
  }
  return (req.socket.remoteAddress ?? "unknown").slice(0, 80);
}
