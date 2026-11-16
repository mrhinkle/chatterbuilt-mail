-- Lane 5c. Device-code sign-in, the owner's own Entra app state, and Graph delta links.
-- 009 belongs to Lane 5a. Dates are ISO-8601 text so PGlite and Postgres compare the same way.

CREATE TABLE IF NOT EXISTS microsoft_device (
  session_hash text PRIMARY KEY,
  device_code_sealed text NOT NULL,
  user_code text NOT NULL,
  verification_uri text NOT NULL,
  expires_at text NOT NULL,
  interval_seconds integer NOT NULL,
  last_poll_at text,
  used_at text
);

CREATE TABLE IF NOT EXISTS microsoft_oauth (
  state_hash text PRIMARY KEY,
  session_hash text NOT NULL,
  verifier_sealed text NOT NULL,
  expires_at text NOT NULL,
  used_at text
);

CREATE TABLE IF NOT EXISTS microsoft_codes (
  code_hash text PRIMARY KEY,
  used_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS microsoft_delta (
  account_id text NOT NULL REFERENCES accounts(id),
  folder text NOT NULL,
  delta_link text,
  PRIMARY KEY (account_id, folder)
);
