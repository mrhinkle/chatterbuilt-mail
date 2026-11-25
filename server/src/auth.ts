import { createHash, timingSafeEqual } from "node:crypto";

/** Hash both sides so the compare stays constant-time for any token length. */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return false;
  return secretEqual(match[1], expected);
}

export function bearerValue(header: string | undefined): string {
  if (!header) return "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] ?? "";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 both sides so different lengths still compare in constant time. */
export function secretEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
