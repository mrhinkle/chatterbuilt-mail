-- Sample calls per session. Every instance that uses this database shares the count.

CREATE TABLE IF NOT EXISTS sample_limits (
  bucket text PRIMARY KEY,
  hits integer NOT NULL,
  window_start text NOT NULL
);
