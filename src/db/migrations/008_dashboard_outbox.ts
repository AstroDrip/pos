// Owner dashboard sync (ADR-6): a transactional outbox of read-only reporting snapshots.
// Nothing is sent anywhere until a dashboard service is chosen and set up (dashboard_enabled stays 0).
export const sql = `
CREATE TABLE sync_outbox (
  id          INTEGER PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,           -- the server de-duplicates on this
  kind        TEXT NOT NULL,                  -- e.g. kpis_day, kpis_month, low_stock, activity, shift
  snap_key    TEXT NOT NULL,                  -- e.g. 2026-11-05; the server keeps the newest version per (kind, snap_key)
  version     INTEGER NOT NULL,               -- increases per (kind, snap_key)
  payload     TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL,
  last_error  TEXT,
  sent_at     TEXT,
  UNIQUE (kind, snap_key, version)
) STRICT;
CREATE INDEX ix_sync_outbox_pending ON sync_outbox(status, next_try_at);

CREATE TABLE sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error      TEXT
) STRICT;
INSERT INTO sync_state (id) VALUES (1);

INSERT INTO settings (key, value) VALUES ('dashboard_enabled', '0');
`;
