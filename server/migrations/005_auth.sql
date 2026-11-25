-- Lane 1d. OAuth clients, hashed tokens, the owner session, and Gmail connect state.
-- Dates are ISO-8601 text so PGlite and Postgres compare the same way.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id text PRIMARY KEY,
  secret_hash text,
  redirect_uris jsonb NOT NULL,
  client_name text NOT NULL DEFAULT '',
  auth_method text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  expires_at text NOT NULL,
  used_at text
);

CREATE TABLE IF NOT EXISTS oauth_refresh (
  token_hash text PRIMARY KEY,
  family_id text NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  expires_at text NOT NULL,
  used_at text,
  revoked_at text
);

CREATE INDEX IF NOT EXISTS oauth_refresh_family ON oauth_refresh (family_id);

CREATE TABLE IF NOT EXISTS oauth_access (
  token_hash text PRIMARY KEY,
  family_id text NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  expires_at text NOT NULL,
  revoked_at text
);

CREATE INDEX IF NOT EXISTS oauth_access_family ON oauth_access (family_id);

CREATE TABLE IF NOT EXISTS owner_sessions (
  session_hash text PRIMARY KEY,
  csrf text NOT NULL,
  authenticated boolean NOT NULL DEFAULT false,
  pending jsonb,
  expires_at text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS passphrase_failures (
  bucket text PRIMARY KEY,
  failures integer NOT NULL,
  window_start text NOT NULL
);

CREATE TABLE IF NOT EXISTS google_oauth (
  state_hash text PRIMARY KEY,
  session_hash text NOT NULL,
  verifier_sealed text NOT NULL,
  expires_at text NOT NULL,
  used_at text
);

CREATE TABLE IF NOT EXISTS google_codes (
  code_hash text PRIMARY KEY,
  used_at text NOT NULL
);
