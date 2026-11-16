import type { Sql } from "../store/sql.js";
import { iso } from "./resource.js";

export type AuthMethod = "none" | "client_secret_basic" | "client_secret_post";

export interface ClientRecord {
  clientId: string;
  secretHash: string | null;
  redirectUris: string[];
  clientName: string;
  authMethod: AuthMethod;
}

export interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  clientName: string;
  state?: string;
}

export interface SessionRecord {
  csrf: string;
  authenticated: boolean;
  pending: PendingAuth | null;
  expiresAt: string;
  createdAt: string;
}

export interface CodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: string;
}

export interface RefreshRecord {
  familyId: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface AccessRecord {
  familyId: string;
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: string;
  revokedAt: string | null;
}

function jsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function pendingFrom(value: unknown): PendingAuth | null {
  const raw = jsonb<unknown>(value, null);
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.clientId !== "string" || typeof row.redirectUri !== "string") return null;
  if (typeof row.codeChallenge !== "string" || typeof row.resource !== "string") return null;
  if (typeof row.scope !== "string" || typeof row.clientName !== "string") return null;
  return {
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    codeChallenge: row.codeChallenge,
    resource: row.resource,
    scope: row.scope,
    clientName: row.clientName,
    ...(typeof row.state === "string" && row.state ? { state: row.state } : {}),
  };
}

function authMethod(value: string): AuthMethod {
  if (value === "client_secret_basic" || value === "client_secret_post") return value;
  return "none";
}

export class AuthStore {
  constructor(private readonly sql: Sql) {}

  async saveClient(client: ClientRecord, at: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO oauth_clients (client_id, secret_hash, redirect_uris, client_name, auth_method, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       ON CONFLICT (client_id) DO NOTHING`,
      [client.clientId, client.secretHash, JSON.stringify(client.redirectUris), client.clientName, client.authMethod, at],
    );
  }

  async client(clientId: string): Promise<ClientRecord | null> {
    const result = await this.sql.query<{
      client_id: string;
      secret_hash: string | null;
      redirect_uris: unknown;
      client_name: string;
      auth_method: string;
    }>(
      "SELECT client_id, secret_hash, redirect_uris, client_name, auth_method FROM oauth_clients WHERE client_id = $1",
      [clientId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const redirectUris = jsonb<unknown>(row.redirect_uris, []);
    return {
      clientId: row.client_id,
      secretHash: row.secret_hash,
      redirectUris: Array.isArray(redirectUris) ? redirectUris.filter((item): item is string => typeof item === "string") : [],
      clientName: row.client_name,
      authMethod: authMethod(row.auth_method),
    };
  }

  /** Registrations in the open hour, and the number of stored clients. */
  async registrationLoad(since: string): Promise<{ recent: number; total: number }> {
    const result = await this.sql.query<{ recent: number | string; total: number | string }>(
      `SELECT
         (SELECT count(*)::int FROM oauth_clients) AS total,
         (SELECT count(*)::int FROM oauth_clients WHERE created_at >= $1) AS recent`,
      [since],
    );
    const row = result.rows[0];
    return { recent: Number(row?.recent ?? 0), total: Number(row?.total ?? 0) };
  }

  async saveCode(codeHash: string, code: CodeRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, resource, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [codeHash, code.clientId, code.redirectUri, code.codeChallenge, code.resource, code.scope, code.expiresAt],
    );
  }

  /** Marks the code used. A second call returns null. The caller still checks expiry. */
  async takeCode(codeHash: string, at: string): Promise<CodeRecord | null> {
    const result = await this.sql.query<{
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      resource: string;
      scope: string;
      expires_at: string;
    }>(
      `UPDATE oauth_codes SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL
       RETURNING client_id, redirect_uri, code_challenge, resource, scope, expires_at`,
      [codeHash, at],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expires_at,
    };
  }

  /** Records the family issued from a code. A second redemption reads it back. */
  async rememberCodeFamily(codeHash: string, familyId: string): Promise<void> {
    await this.sql.query(
      "UPDATE oauth_codes SET family_id = $2 WHERE code_hash = $1 AND family_id IS NULL",
      [codeHash, familyId],
    );
  }

  /** Family issued from a code that has already been used. */
  async codeFamily(codeHash: string): Promise<string | null> {
    const result = await this.sql.query<{ family_id: string | null }>(
      "SELECT family_id FROM oauth_codes WHERE code_hash = $1 AND used_at IS NOT NULL",
      [codeHash],
    );
    const family = result.rows[0]?.family_id;
    return family ? family : null;
  }

  async saveRefresh(tokenHash: string, row: { familyId: string; clientId: string; resource: string; scope: string; expiresAt: string }): Promise<void> {
    await this.sql.query(
      `INSERT INTO oauth_refresh (token_hash, family_id, client_id, resource, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, row.familyId, row.clientId, row.resource, row.scope, row.expiresAt],
    );
  }

  /** Claims an unused, unrevoked, unexpired refresh token. */
  async takeRefresh(tokenHash: string, at: string): Promise<RefreshRecord | null> {
    const result = await this.sql.query<{
      family_id: string;
      client_id: string;
      resource: string;
      scope: string;
      expires_at: string;
    }>(
      `UPDATE oauth_refresh SET used_at = $2
       WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2
       RETURNING family_id, client_id, resource, scope, expires_at`,
      [tokenHash, at],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      familyId: row.family_id,
      clientId: row.client_id,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expires_at,
      usedAt: at,
      revokedAt: null,
    };
  }

  async refreshRow(tokenHash: string): Promise<RefreshRecord | null> {
    const result = await this.sql.query<{
      family_id: string;
      client_id: string;
      resource: string;
      scope: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
    }>(
      "SELECT family_id, client_id, resource, scope, expires_at, used_at, revoked_at FROM oauth_refresh WHERE token_hash = $1",
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      familyId: row.family_id,
      clientId: row.client_id,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
    };
  }

  async revokeFamily(familyId: string, at: string): Promise<void> {
    await this.sql.query(
      "UPDATE oauth_refresh SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL",
      [familyId, at],
    );
    await this.sql.query(
      "UPDATE oauth_access SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL",
      [familyId, at],
    );
  }

  async saveAccess(tokenHash: string, row: { familyId: string; clientId: string; resource: string; scope: string; expiresAt: string }): Promise<void> {
    await this.sql.query(
      `INSERT INTO oauth_access (token_hash, family_id, client_id, resource, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, row.familyId, row.clientId, row.resource, row.scope, row.expiresAt],
    );
  }

  async access(tokenHash: string): Promise<AccessRecord | null> {
    const result = await this.sql.query<{
      family_id: string;
      client_id: string;
      resource: string;
      scope: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      "SELECT family_id, client_id, resource, scope, expires_at, revoked_at FROM oauth_access WHERE token_hash = $1",
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      familyId: row.family_id,
      clientId: row.client_id,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async saveSession(sessionHash: string, session: SessionRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO owner_sessions (session_hash, csrf, authenticated, pending, expires_at, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (session_hash) DO UPDATE SET
         csrf = EXCLUDED.csrf,
         authenticated = EXCLUDED.authenticated,
         pending = EXCLUDED.pending,
         expires_at = EXCLUDED.expires_at`,
      [
        sessionHash,
        session.csrf,
        session.authenticated,
        session.pending ? JSON.stringify(session.pending) : null,
        session.expiresAt,
        session.createdAt,
      ],
    );
  }

  async session(sessionHash: string): Promise<SessionRecord | null> {
    const result = await this.sql.query<{
      csrf: string;
      authenticated: unknown;
      pending: unknown;
      expires_at: string;
      created_at: string;
    }>(
      "SELECT csrf, authenticated, pending, expires_at, created_at FROM owner_sessions WHERE session_hash = $1",
      [sessionHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      csrf: row.csrf,
      authenticated: flag(row.authenticated),
      pending: pendingFrom(row.pending),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.sql.query("DELETE FROM owner_sessions WHERE session_hash = $1", [sessionHash]);
  }

  async failureCount(bucket: string, nowMs: number, windowMs: number): Promise<number> {
    const result = await this.sql.query<{ failures: number | string; window_start: string }>(
      "SELECT failures, window_start FROM passphrase_failures WHERE bucket = $1",
      [bucket],
    );
    const row = result.rows[0];
    if (!row) return 0;
    if (row.window_start < iso(nowMs - windowMs)) return 0;
    return Number(row.failures);
  }

  /** Milliseconds left in the window, or 0 if it is not open. */
  async failureWindowRemaining(bucket: string, nowMs: number, windowMs: number): Promise<number> {
    const result = await this.sql.query<{ window_start: string }>(
      "SELECT window_start FROM passphrase_failures WHERE bucket = $1",
      [bucket],
    );
    const row = result.rows[0];
    if (!row) return 0;
    const start = Date.parse(row.window_start);
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, start + windowMs - nowMs);
  }

  async bumpFailure(bucket: string, nowMs: number, windowMs: number): Promise<void> {
    const now = iso(nowMs);
    const cutoff = iso(nowMs - windowMs);
    await this.sql.query(
      `INSERT INTO passphrase_failures (bucket, failures, window_start)
       VALUES ($1, 1, $2)
       ON CONFLICT (bucket) DO UPDATE SET
         failures = CASE WHEN passphrase_failures.window_start < $3 THEN 1 ELSE passphrase_failures.failures + 1 END,
         window_start = CASE WHEN passphrase_failures.window_start < $3 THEN $2 ELSE passphrase_failures.window_start END`,
      [bucket, now, cutoff],
    );
  }

  /**
   * Counts one sample call in the shared store. A call past the limit returns false
   * and still records the hit, so a second instance sees the same window.
   */
  async allowSample(bucket: string, nowMs: number, windowMs: number, limit: number): Promise<boolean> {
    const now = iso(nowMs);
    const cutoff = iso(nowMs - windowMs);
    const result = await this.sql.query<{ hits: number | string }>(
      `INSERT INTO sample_limits (bucket, hits, window_start)
       VALUES ($1, 1, $2)
       ON CONFLICT (bucket) DO UPDATE SET
         hits = CASE WHEN sample_limits.window_start < $3 THEN 1 ELSE sample_limits.hits + 1 END,
         window_start = CASE WHEN sample_limits.window_start < $3 THEN $2 ELSE sample_limits.window_start END
       RETURNING hits`,
      [bucket, now, cutoff],
    );
    return Number(result.rows[0]?.hits ?? limit + 1) <= limit;
  }

  async saveGoogle(stateHash: string, sessionHash: string, verifierSealed: string, expiresAt: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO google_oauth (state_hash, session_hash, verifier_sealed, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [stateHash, sessionHash, verifierSealed, expiresAt],
    );
  }

  /** Claims the state for this session. A wrong, expired, or reused state returns null. */
  async takeGoogle(stateHash: string, sessionHash: string, at: string): Promise<string | null> {
    const result = await this.sql.query<{ verifier_sealed: string }>(
      `UPDATE google_oauth SET used_at = $3
       WHERE state_hash = $1 AND session_hash = $2 AND used_at IS NULL AND expires_at > $3
       RETURNING verifier_sealed`,
      [stateHash, sessionHash, at],
    );
    return result.rows[0]?.verifier_sealed ?? null;
  }

  /** First sight of a Google code returns true. A replay returns false. */
  async takeGoogleCode(codeHash: string, at: string): Promise<boolean> {
    const result = await this.sql.query<{ code_hash: string }>(
      `INSERT INTO google_codes (code_hash, used_at) VALUES ($1, $2)
       ON CONFLICT (code_hash) DO NOTHING
       RETURNING code_hash`,
      [codeHash, at],
    );
    return result.rows.length > 0;
  }

  async saveMicrosoft(stateHash: string, sessionHash: string, verifierSealed: string, expiresAt: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO microsoft_oauth (state_hash, session_hash, verifier_sealed, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [stateHash, sessionHash, verifierSealed, expiresAt],
    );
  }

  /** Claims the state for this session. A wrong session, an old state, or a used state returns null. */
  async takeMicrosoft(stateHash: string, sessionHash: string, at: string): Promise<string | null> {
    const result = await this.sql.query<{ verifier_sealed: string }>(
      `UPDATE microsoft_oauth SET used_at = $3
       WHERE state_hash = $1 AND session_hash = $2 AND used_at IS NULL AND expires_at > $3
       RETURNING verifier_sealed`,
      [stateHash, sessionHash, at],
    );
    return result.rows[0]?.verifier_sealed ?? null;
  }

  /** First sight of a Microsoft authorization code returns true. A replay returns false. */
  async takeMicrosoftCode(codeHash: string, at: string): Promise<boolean> {
    const result = await this.sql.query<{ code_hash: string }>(
      `INSERT INTO microsoft_codes (code_hash, used_at) VALUES ($1, $2)
       ON CONFLICT (code_hash) DO NOTHING
       RETURNING code_hash`,
      [codeHash, at],
    );
    return result.rows.length > 0;
  }

  /** Replaces any device-code row for this session. The sealed value is the device_code. */
  async saveDevice(row: {
    sessionHash: string;
    deviceCodeSealed: string;
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSeconds: number;
  }): Promise<void> {
    await this.sql.query(
      `INSERT INTO microsoft_device (
         session_hash, device_code_sealed, user_code, verification_uri, expires_at, interval_seconds, last_poll_at, used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
       ON CONFLICT (session_hash) DO UPDATE SET
         device_code_sealed = EXCLUDED.device_code_sealed,
         user_code = EXCLUDED.user_code,
         verification_uri = EXCLUDED.verification_uri,
         expires_at = EXCLUDED.expires_at,
         interval_seconds = EXCLUDED.interval_seconds,
         last_poll_at = NULL,
         used_at = NULL`,
      [row.sessionHash, row.deviceCodeSealed, row.userCode, row.verificationUri, row.expiresAt, row.intervalSeconds],
    );
  }

  async deviceForSession(sessionHash: string): Promise<DeviceRow | null> {
    const result = await this.sql.query<{
      device_code_sealed: string;
      user_code: string;
      verification_uri: string;
      expires_at: string;
      interval_seconds: number | string;
      last_poll_at: string | null;
      used_at: string | null;
    }>(
      `SELECT device_code_sealed, user_code, verification_uri, expires_at, interval_seconds, last_poll_at, used_at
       FROM microsoft_device WHERE session_hash = $1`,
      [sessionHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      deviceCodeSealed: row.device_code_sealed,
      userCode: row.user_code,
      verificationUri: row.verification_uri,
      expiresAt: row.expires_at,
      intervalSeconds: Number(row.interval_seconds),
      lastPollAt: row.last_poll_at,
      usedAt: row.used_at,
    };
  }

  /**
   * One poll claim. The expected last-poll time must still match, so two status
   * requests cannot both win. A miss means another request already polled.
   */
  async claimDevicePoll(sessionHash: string, expectedLastPoll: string | null, now: string): Promise<boolean> {
    const result = await this.sql.query<{ session_hash: string }>(
      `UPDATE microsoft_device SET last_poll_at = $1
       WHERE session_hash = $2 AND used_at IS NULL AND expires_at > $1
         AND last_poll_at IS NOT DISTINCT FROM $3
       RETURNING session_hash`,
      [now, sessionHash, expectedLastPoll],
    );
    return result.rows.length > 0;
  }

  /** slow_down adds five seconds, per Microsoft's device-code guidance. */
  async bumpDeviceInterval(sessionHash: string, now: string): Promise<number> {
    const result = await this.sql.query<{ interval_seconds: number | string }>(
      `UPDATE microsoft_device
       SET interval_seconds = interval_seconds + 5, last_poll_at = $2
       WHERE session_hash = $1
       RETURNING interval_seconds`,
      [sessionHash, now],
    );
    return Number(result.rows[0]?.interval_seconds ?? 5);
  }

  async deleteDevice(sessionHash: string): Promise<void> {
    await this.sql.query("DELETE FROM microsoft_device WHERE session_hash = $1", [sessionHash]);
  }

  async ownerPassphraseHash(): Promise<string | null> {
    const result = await this.sql.query<{ passphrase_hash: string }>(
      "SELECT passphrase_hash FROM owner_setup WHERE id = 1",
    );
    return result.rows[0]?.passphrase_hash ?? null;
  }

  async ownerZone(): Promise<string | null> {
    const result = await this.sql.query<{ timezone: string | null }>(
      "SELECT timezone FROM owner_setup WHERE id = 1",
    );
    return result.rows[0]?.timezone ?? null;
  }

  async providerClient(provider: "google" | "microsoft"): Promise<{ clientId: string; secretSealed: string | null } | null> {
    const result = await this.sql.query<{ client_id: string; secret_sealed: string | null }>(
      "SELECT client_id, secret_sealed FROM provider_clients WHERE provider = $1",
      [provider],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { clientId: row.client_id, secretSealed: row.secret_sealed };
  }

  async saveProviderClient(provider: "google" | "microsoft", clientId: string, secretSealed: string | null, createdAt: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO provider_clients (provider, client_id, secret_sealed, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         secret_sealed = EXCLUDED.secret_sealed,
         created_at = EXCLUDED.created_at`,
      [provider, clientId, secretSealed, createdAt],
    );
  }

  /** Inserts the single owner row. False means another claim won. */
  async claimOwner(passphraseHash: string, timezone: string | null, claimedAt: string): Promise<boolean> {
    const result = await this.sql.query<{ id: number }>(
      `INSERT INTO owner_setup (id, passphrase_hash, timezone, claimed_at)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [passphraseHash, timezone, claimedAt],
    );
    return result.rows.length === 1;
  }
}

export interface DeviceRow {
  deviceCodeSealed: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
  lastPollAt: string | null;
  usedAt: string | null;
}
