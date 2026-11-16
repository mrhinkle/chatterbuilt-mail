import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * OWASP's scrypt minimum is N = 2^17, r = 8, p = 1, with a 32-byte key.
 * Node's default maxmem is 32 MiB, which refuses N = 2^17 (about 128 MiB).
 * https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
const MAXMEM = 256 * 1024 * 1024;
const DEFAULT_LOG_N = 17;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const WARN = "sign-in passphrase hash is not usable";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Test-only cost. Production leaves this unset. Verify ignores it and reads the stored row. */
export interface PassphraseCost {
  /** log2 of scrypt N. Allowed range is 14 through 20. Production uses 17. */
  logN: number;
  r?: number;
  p?: number;
}

interface ParsedHash {
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function costOf(cost?: PassphraseCost): { logN: number; r: number; p: number } {
  const logN = cost?.logN ?? DEFAULT_LOG_N;
  const r = cost?.r ?? DEFAULT_R;
  const p = cost?.p ?? DEFAULT_P;
  if (!Number.isInteger(logN) || logN < 14 || logN > 20) {
    throw new Error("passphrase cost is outside the allowed range");
  }
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 16) {
    throw new Error("passphrase cost is outside the allowed range");
  }
  return { logN, r, p };
}

/** Random 16-byte salt. Stored as scrypt$<log2 N>$<r>$<p>$<salt>$<hash>, base64url, no padding. */
export async function hashPassphrase(passphrase: string, cost?: PassphraseCost): Promise<string> {
  const chosen = costOf(cost);
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(passphrase, salt, KEY_LEN, {
    N: 2 ** chosen.logN,
    r: chosen.r,
    p: chosen.p,
    maxmem: MAXMEM,
  });
  return `scrypt$${chosen.logN}$${chosen.r}$${chosen.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function parseStored(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const prefix = parts[0];
  const logNText = parts[1];
  const rText = parts[2];
  const pText = parts[3];
  const saltText = parts[4];
  const hashText = parts[5];
  if (prefix !== "scrypt" || logNText === undefined || rText === undefined || pText === undefined) return null;
  if (saltText === undefined || hashText === undefined) return null;
  if (!/^\d+$/.test(logNText) || !/^\d+$/.test(rText) || !/^\d+$/.test(pText)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(saltText) || !/^[A-Za-z0-9_-]+$/.test(hashText)) return null;
  const logN = Number(logNText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(logN) || logN < 14 || logN > 20) return null;
  if (!Number.isInteger(r) || r < 1 || r > 16) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length !== SALT_LEN || hash.length !== KEY_LEN) return null;
  if (salt.toString("base64url") !== saltText || hash.toString("base64url") !== hashText) return null;
  return { logN, r, p, salt, hash };
}

/** False for a wrong passphrase, a legacy hash, or any string that is not a scrypt row. One warning, and never the stored value. */
export async function verifyPassphrase(
  passphrase: string,
  stored: string,
  warn: (message: string) => void,
): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) {
    warn(WARN);
    return false;
  }
  let derived: Buffer;
  try {
    derived = await scryptAsync(passphrase, parsed.salt, KEY_LEN, {
      N: 2 ** parsed.logN,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    });
  } catch {
    warn(WARN);
    return false;
  }
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}
