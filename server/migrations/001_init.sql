-- Lane 1a schema. Later slices fill the write and sync paths.
-- Dates are ISO-8601 text so PGlite and Postgres return the same shape.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gmail', 'imap')),
  color text,
  position integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_tokens (
  account_id text PRIMARY KEY REFERENCES accounts(id),
  ciphertext text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  account_id text NOT NULL REFERENCES accounts(id),
  id text NOT NULL,
  snippet text NOT NULL DEFAULT '',
  message_count integer NOT NULL DEFAULT 0,
  history_id text,
  view_url text NOT NULL DEFAULT '',
  updated_at text NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS messages (
  account_id text NOT NULL REFERENCES accounts(id),
  id text NOT NULL,
  thread_id text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  sender text NOT NULL DEFAULT '',
  to_recipients jsonb NOT NULL DEFAULT '[]',
  cc_recipients jsonb NOT NULL DEFAULT '[]',
  bcc_recipients jsonb NOT NULL DEFAULT '[]',
  reply_to jsonb NOT NULL DEFAULT '[]',
  in_reply_to text NOT NULL DEFAULT '',
  references_header text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  label_ids jsonb NOT NULL DEFAULT '[]',
  snippet text NOT NULL DEFAULT '',
  text_body text,
  html_body text,
  attachments jsonb NOT NULL DEFAULT '[]',
  raw text,
  body_fetched boolean NOT NULL DEFAULT false,
  view_url text NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS labels (
  account_id text NOT NULL REFERENCES accounts(id),
  label_id text NOT NULL,
  name text NOT NULL,
  label_type text NOT NULL CHECK (label_type IN ('SYSTEM', 'USER')),
  PRIMARY KEY (account_id, label_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  account_id text NOT NULL REFERENCES accounts(id),
  id text NOT NULL,
  message_id text NOT NULL DEFAULT '',
  thread_id text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  to_recipients jsonb NOT NULL DEFAULT '[]',
  cc_recipients jsonb NOT NULL DEFAULT '[]',
  bcc_recipients jsonb NOT NULL DEFAULT '[]',
  date text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  text_body text,
  html_body text,
  attachments jsonb NOT NULL DEFAULT '[]',
  label_ids jsonb NOT NULL DEFAULT '[]',
  raw text,
  view_url text NOT NULL DEFAULT '',
  body_fetched boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS filters (
  account_id text NOT NULL REFERENCES accounts(id),
  id text NOT NULL,
  criteria jsonb NOT NULL,
  action jsonb NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id text PRIMARY KEY REFERENCES accounts(id),
  history_id text,
  uidvalidity text,
  modseq text,
  uids jsonb NOT NULL DEFAULT '{}',
  indexed_at text,
  bodies_at text,
  last_sync_at text
);

CREATE TABLE IF NOT EXISTS send_as (
  account_id text NOT NULL REFERENCES accounts(id),
  email text NOT NULL,
  signature text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, email)
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  account_id text,
  kind text NOT NULL,
  run_at text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  done_at text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  account_id text,
  action text NOT NULL,
  at text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'
);
