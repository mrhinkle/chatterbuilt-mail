import type { IncomingMessage } from "node:http";

/** Vercel rewrites public paths onto /api/*. Accept either form. */
const ALIASES: Record<string, string> = {
  "/api/mcp": "/mcp",
  "/api/authorize": "/authorize",
  "/api/token": "/token",
  "/api/register": "/register",
  "/api/signin": "/signin",
  "/api/oauth-protected-resource": "/.well-known/oauth-protected-resource",
  "/api/oauth-protected-resource-mcp": "/.well-known/oauth-protected-resource/mcp",
  "/api/oauth-authorization-server": "/.well-known/oauth-authorization-server",
  "/api/setup": "/setup",
  "/api/connect": "/connect",
  "/api/connect/google/client": "/connect/google/client",
  "/api/connect/google": "/connect/google",
  "/api/connect/google/callback": "/connect/google/callback",
  "/api/connect/google/disconnect": "/connect/google/disconnect",
  "/api/connect/microsoft/device/status": "/connect/microsoft/device/status",
  "/api/connect/microsoft/callback": "/connect/microsoft/callback",
  "/api/connect/microsoft/disconnect": "/connect/microsoft/disconnect",
  "/api/connect/microsoft/client": "/connect/microsoft/client",
  "/api/connect/microsoft": "/connect/microsoft",
  "/api/connect/imap": "/connect/imap",
  "/api/connect/other": "/connect/other",
  "/api/app": "/app",
  "/api/app-call": "/app/api/call",
  "/api/app-sample": "/app/api/sample",
  "/api/app-manifest": "/app/manifest.webmanifest",
  "/api/app-icon": "/app/icon.svg",
};

export function requestPath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const query = raw.indexOf("?");
  const path = query === -1 ? raw : raw.slice(0, query);
  const normal = path.startsWith("/") ? path : `/${path}`;
  const trimmed = normal.length > 1 ? normal.replace(/\/+$/, "") : normal;
  return ALIASES[trimmed] ?? trimmed;
}
