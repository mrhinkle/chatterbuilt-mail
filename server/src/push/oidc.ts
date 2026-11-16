import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

export class PushAuthError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "PushAuthError";
  }
}

interface RsaJwk extends JsonWebKey {
  kid?: string;
  kty?: string;
}

export interface PushCheck {
  audience: string;
  serviceAccount: string;
  /** Inline JWKS JSON. Parsed on every call so tests can use a different key. */
  jwksJson?: string;
  /** Used only when jwksJson is absent and nodeEnv is production. */
  nodeEnv: string;
  timeoutMs: number;
  now?: number;
}

interface JwtPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  email_verified?: boolean;
}

let googleKeys: { at: number; keys: RsaJwk[] } | null = null;

function decode(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

function parseKeys(raw: string): RsaJwk[] {
  let parsed: { keys?: RsaJwk[] };
  try {
    parsed = JSON.parse(raw) as { keys?: RsaJwk[] };
  } catch {
    throw new PushAuthError();
  }
  if (!parsed.keys || parsed.keys.length === 0) throw new PushAuthError();
  return parsed.keys;
}

async function keysFor(check: PushCheck): Promise<RsaJwk[]> {
  if (check.jwksJson) {
    if (check.nodeEnv === "production") throw new PushAuthError();
    return parseKeys(check.jwksJson);
  }
  if (check.nodeEnv !== "production") throw new PushAuthError();
  if (googleKeys && Date.now() - googleKeys.at < 3_600_000) return googleKeys.keys;
  let response: Response;
  try {
    response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      signal: AbortSignal.timeout(check.timeoutMs),
    });
  } catch {
    throw new PushAuthError();
  }
  if (!response.ok) throw new PushAuthError();
  const keys = parseKeys(await response.text());
  googleKeys = { at: Date.now(), keys };
  return keys;
}

/**
 * Pub/Sub push OIDC. RS256 only. `iss` is Google, `aud` and `email` are the
 * configured audience and service account, and `email_verified` is true.
 */
export async function verifyPushToken(token: string, check: PushCheck): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PushAuthError();
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new PushAuthError();
  let header: { alg?: string; kid?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(decode(encodedHeader)) as { alg?: string; kid?: string };
    payload = JSON.parse(decode(encodedPayload)) as JwtPayload;
  } catch {
    throw new PushAuthError();
  }
  if (header.alg !== "RS256" || !header.kid) throw new PushAuthError();
  const keys = await keysFor(check);
  const jwk = keys.find((key) => key.kid === header.kid && (key.kty === "RSA" || key.kty === undefined));
  if (!jwk) throw new PushAuthError();
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new PushAuthError();
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const signature = Buffer.from(encodedSignature, "base64url");
  const signed = verifier.verify(publicKey, signature);
  if (!signed) throw new PushAuthError();
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new PushAuthError();
  }
  const audienceOk = typeof payload.aud === "string"
    ? payload.aud === check.audience
    : Array.isArray(payload.aud) && payload.aud.includes(check.audience);
  if (!audienceOk) throw new PushAuthError();
  if (payload.email !== check.serviceAccount || payload.email_verified !== true) throw new PushAuthError();
  const now = check.now ?? Date.now();
  if (typeof payload.exp !== "number" || payload.exp * 1000 + 30_000 < now) throw new PushAuthError();
}
