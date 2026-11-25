import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolError } from "../errors.js";

const REFUSED = "That mail host is not allowed.";

/** Cloud metadata addresses stay refused even when private hosts are allowed for dev. */
const METADATA_V4 = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200"]);

export function isIpLiteral(host: string): boolean {
  return isIP(host) !== 0;
}

export async function resolveHost(host: string): Promise<string[]> {
  if (isIpLiteral(host)) return [host];
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

/**
 * One lookup. If any answer is forbidden, the host is refused. The socket then
 * uses the chosen address, so a later DNS answer cannot swap it.
 */
export async function pinHost(
  host: string,
  resolve: (host: string) => Promise<string[]>,
  allowPrivate: boolean,
): Promise<string> {
  const name = host.trim();
  if (!name || name.length > 253 || /[\s/\\]/.test(name)) {
    throw new ToolError("tool_error", REFUSED);
  }
  let addresses: string[];
  try {
    addresses = await resolve(name);
  } catch {
    throw new ToolError("tool_error", "That mail host did not resolve.");
  }
  if (addresses.length === 0) throw new ToolError("tool_error", "That mail host did not resolve.");
  if (addresses.some((address) => isMetadata(address))) throw new ToolError("tool_error", REFUSED);
  if (!allowPrivate && addresses.some((address) => isBlocked(address))) {
    throw new ToolError("tool_error", REFUSED);
  }
  const chosen = addresses.find((address) => !isMetadata(address) && (allowPrivate || !isBlocked(address)));
  if (!chosen) throw new ToolError("tool_error", REFUSED);
  return chosen;
}

export function isBlocked(address: string): boolean {
  if (isMetadata(address)) return true;
  const v4 = ipv4(address);
  if (v4) return blockedV4(v4);
  return blockedV6(address);
}

function isMetadata(address: string): boolean {
  const v4 = ipv4(address);
  if (v4 && METADATA_V4.has(v4)) return true;
  const packed = v6Bytes(address);
  if (!packed) return false;
  // fd00:ec2::254 (AWS IPv6 metadata). Unique-local is already blocked unless private hosts are allowed.
  return packed[0] === 0xfd && packed[1] === 0x00 && packed[2] === 0x0e && packed[3] === 0xc2
    && packed[14] === 0x02 && packed[15] === 0x54;
}

function blockedV4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 255) return true;
  return false;
}

function blockedV6(address: string): boolean {
  const packed = v6Bytes(address);
  if (!packed) return true;
  const mapped = mappedV4(packed);
  if (mapped) return blockedV4(mapped);
  if (packed.every((byte) => byte === 0)) return true;
  if (packed.slice(0, 15).every((byte) => byte === 0) && packed[15] === 1) return true;
  const first = packed[0] ?? 0;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && ((packed[1] ?? 0) & 0xc0) === 0x80) return true;
  return false;
}

function ipv4(address: string): string | null {
  const zone = address.split("%")[0] ?? address;
  if (isIP(zone) === 4) return zone;
  return null;
}

function v6Bytes(address: string): number[] | null {
  const zone = (address.split("%")[0] ?? address).toLowerCase();
  if (zone.startsWith("::ffff:")) {
    const tail = zone.slice(7);
    if (isIP(tail) === 4) {
      const parts = tail.split(".").map((part) => Number(part));
      return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...parts];
    }
  }
  if (isIP(zone) !== 6) return null;
  const halves = zone.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (halves.length === 2 && missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function mappedV4(bytes: number[]): string | null {
  const prefix = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (!prefix) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}
