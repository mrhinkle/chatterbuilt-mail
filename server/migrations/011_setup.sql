-- Lane 5b. One owner claim, and OAuth clients saved from /connect.
-- Dates are ISO-8601 text so PGlite and Postgres compare the same way.

CREATE TABLE IF NOT EXISTS owner_setup (
  id integer PRIMARY KEY CHECK (id = 1),
  passphrase_hash text NOT NULL,
  timezone text,
  claimed_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_clients (
  provider text PRIMARY KEY CHECK (provider IN ('google', 'microsoft')),
  client_id text NOT NULL,
  secret_sealed text,
  created_at text NOT NULL
);
