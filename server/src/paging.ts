import { ToolError } from "./errors.js";

export function pageSizeOf(value: number | undefined): number {
  if (value == null) return 25;
  if (!Number.isInteger(value) || value < 1) throw new ToolError("tool_error", "Invalid page size.");
  return Math.min(value, 50);
}

export function offsetOf(token: string | undefined): number {
  if (!token) return 0;
  let text = "";
  try {
    text = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new ToolError("tool_error", "Invalid page token.");
  }
  const match = /^o:(\d+)$/.exec(text);
  if (!match) throw new ToolError("tool_error", "Invalid page token.");
  return Number(match[1]);
}

export function nextToken(offset: number, pageSize: number, total: number): string | null {
  const next = offset + pageSize;
  if (next >= total) return null;
  return Buffer.from(`o:${next}`, "utf8").toString("base64url");
}
