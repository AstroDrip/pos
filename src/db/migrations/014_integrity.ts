// Results of the books check, and the notes an administrator adds to them. Never touches a financial record.
export const sql = `
CREATE TABLE integrity_runs (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id)
) STRICT;
CREATE TABLE integrity_findings (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES integrity_runs(id),
  fingerprint TEXT NOT NULL,
  check_id    TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critical','warning')),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  problem     TEXT NOT NULL,
  explanation TEXT NOT NULL,
  suggestion  TEXT NOT NULL
) STRICT;
CREATE INDEX ix_integrity_findings_run ON integrity_findings(run_id);
CREATE TABLE integrity_reviews (
  id          INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  note        TEXT NOT NULL CHECK (length(note) > 0),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  at          TEXT NOT NULL
) STRICT;
CREATE INDEX ix_integrity_reviews_print ON integrity_reviews(fingerprint);
`;
