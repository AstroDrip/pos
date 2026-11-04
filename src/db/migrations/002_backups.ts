// Local backup bookkeeping (plan §J). Cloud upload states are added in the off-site backup phase.
export const sql = `
CREATE TABLE backup_jobs (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual','shift_close','scheduled','pre_restore')),
  user_id       INTEGER REFERENCES users(id),
  file_name     TEXT,
  size_bytes    INTEGER,
  file_sha256   TEXT,
  key_id        TEXT,
  status        TEXT NOT NULL CHECK (status IN ('verified_local','failed','pruned')),
  error         TEXT,
  manifest_json TEXT
) STRICT;
CREATE INDEX ix_backup_jobs_created ON backup_jobs(created_at);

CREATE TABLE restore_events (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL,
  user_id      INTEGER,
  backup_id    TEXT NOT NULL,
  manifest_json TEXT NOT NULL
) STRICT;
`;
