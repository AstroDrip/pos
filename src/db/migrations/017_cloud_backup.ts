// Encrypted copies of local backups waiting to go to the cloud, and how far each got. Survives restarts.
export const sql = `
CREATE TABLE cloud_uploads (
  backup_id        TEXT PRIMARY KEY,
  file_name        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  encrypted_bytes  INTEGER NOT NULL CHECK (encrypted_bytes > 0),
  original_bytes   INTEGER NOT NULL CHECK (original_bytes > 0),
  status           TEXT NOT NULL CHECK (status IN ('queued','uploaded','failed','superseded')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_try_at      TEXT NOT NULL,
  last_error       TEXT,
  error_kind       TEXT CHECK (error_kind IN ('offline','remote','rejected')),
  uploaded_at      TEXT,
  full_verified_at TEXT,
  full_verify_ok   INTEGER CHECK (full_verify_ok IN (0,1))
) STRICT;
CREATE INDEX ix_cloud_uploads_status ON cloud_uploads(status, next_try_at);

INSERT INTO settings (key, value) VALUES ('cloud_backup_every_hours', '24');
`;
