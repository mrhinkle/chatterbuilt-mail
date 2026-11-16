-- An unfinished wake can be claimed again after the lease. A read records when it
-- last ran jobs, and a wake label records when a search last found it empty.

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_jobs_at text;

CREATE TABLE IF NOT EXISTS wake_empty (
  account_id text NOT NULL,
  label_id text NOT NULL,
  empty_at text NOT NULL,
  PRIMARY KEY (account_id, label_id)
);
