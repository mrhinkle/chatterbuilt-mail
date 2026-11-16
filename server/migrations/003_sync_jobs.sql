-- Lane 1c. Resume cursor for a budgeted backfill, threads a failed store must fetch again,
-- and the claim column that makes a wake run once.

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'backfill';
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS page_token text;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS page_offset integer NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS anchor_history_id text;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at text;

CREATE TABLE IF NOT EXISTS resync_threads (
  account_id text NOT NULL,
  thread_id text NOT NULL,
  reason text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (account_id, thread_id)
);

CREATE TABLE IF NOT EXISTS sync_seen (
  account_id text NOT NULL,
  message_id text NOT NULL,
  PRIMARY KEY (account_id, message_id)
);
