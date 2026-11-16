-- Per-folder IMAP state. sync_state stays one row per account.
CREATE TABLE IF NOT EXISTS imap_mailboxes (
  account_id text PRIMARY KEY REFERENCES accounts(id),
  host text NOT NULL,
  port integer NOT NULL,
  security text NOT NULL CHECK (security IN ('tls', 'starttls')),
  username text NOT NULL,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL,
  smtp_security text NOT NULL CHECK (smtp_security IN ('tls', 'starttls')),
  save_sent boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS imap_copies (
  account_id text NOT NULL REFERENCES accounts(id),
  message_id text NOT NULL,
  folder text NOT NULL,
  uidvalidity text NOT NULL,
  uid bigint NOT NULL,
  PRIMARY KEY (account_id, folder, uidvalidity, uid)
);

CREATE INDEX IF NOT EXISTS imap_copies_message ON imap_copies (account_id, message_id);

CREATE TABLE IF NOT EXISTS imap_folder_state (
  account_id text NOT NULL REFERENCES accounts(id),
  folder text NOT NULL,
  uidvalidity text NOT NULL,
  highest_uid bigint NOT NULL DEFAULT 0,
  highest_modseq text,
  synced_at text,
  PRIMARY KEY (account_id, folder)
);

CREATE TABLE IF NOT EXISTS imap_connect_attempts (
  id text PRIMARY KEY,
  session_hash text NOT NULL,
  at text NOT NULL
);

CREATE INDEX IF NOT EXISTS imap_connect_attempts_session ON imap_connect_attempts (session_hash, at);
