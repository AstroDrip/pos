// Prepaid expenses are recognised by a person, for a named month. One row per confirmed run.
export const sql = `
CREATE TABLE prepaid_runs (
  id          INTEGER PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  month       TEXT NOT NULL,
  total       INTEGER NOT NULL CHECK (total >= 0),
  lines       INTEGER NOT NULL CHECK (lines >= 0),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
CREATE TRIGGER trg_prepaid_runs_no_update BEFORE UPDATE ON prepaid_runs
BEGIN SELECT RAISE(ABORT, 'prepaid_runs is immutable'); END;
CREATE TRIGGER trg_prepaid_runs_no_delete BEFORE DELETE ON prepaid_runs
BEGIN SELECT RAISE(ABORT, 'prepaid_runs is immutable'); END;
`;
