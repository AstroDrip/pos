-- Each purpose has its own schema. The dashboard roles can never read the backup schema.
CREATE SCHEMA dash_auth;
CREATE SCHEMA cloud;
CREATE SCHEMA backup;
CREATE SCHEMA sync;
CREATE SCHEMA readmodel;
CREATE SCHEMA demo;

CREATE TABLE cloud.stores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  recovery_verifier text,
  retention_daily   integer NOT NULL DEFAULT 7 CHECK (retention_daily >= 1),
  retention_weekly  integer NOT NULL DEFAULT 4 CHECK (retention_weekly >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cloud.enrollment_codes (
  code_hash  text PRIMARY KEY,
  store_id   uuid NOT NULL REFERENCES cloud.stores(id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE TABLE cloud.devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES cloud.stores(id),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  secret_hash  text NOT NULL,
  app_version  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX ix_devices_store ON cloud.devices(store_id);
CREATE TABLE cloud.audit_log (
  id        bigserial PRIMARY KEY,
  store_id  uuid,
  device_id uuid,
  action    text NOT NULL,
  detail    jsonb NOT NULL DEFAULT '{}',
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cloud_audit_store ON cloud.audit_log(store_id, at);
CREATE TABLE cloud.rate_limits (
  id  bigserial PRIMARY KEY,
  key text NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rate_limits ON cloud.rate_limits(key, at);

CREATE TABLE backup.manifests (
  store_id            uuid NOT NULL REFERENCES cloud.stores(id),
  backup_id           text NOT NULL CHECK (length(backup_id) BETWEEN 8 AND 64),
  device_id           uuid NOT NULL REFERENCES cloud.devices(id),
  client_created_at   timestamptz NOT NULL,
  app_version         text NOT NULL,
  schema_version      integer NOT NULL CHECK (schema_version > 0),
  format_version      integer NOT NULL CHECK (format_version > 0),
  encryption_version  integer NOT NULL CHECK (encryption_version > 0),
  original_bytes      bigint NOT NULL CHECK (original_bytes > 0),
  encrypted_bytes     bigint NOT NULL CHECK (encrypted_bytes > 0),
  sha256              text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  chunk_count         integer NOT NULL CHECK (chunk_count > 0),
  chunk_size          integer NOT NULL CHECK (chunk_size > 0),
  chunks_root         text NOT NULL CHECK (chunks_root ~ '^[0-9a-f]{64}$'),
  upload_status       text NOT NULL DEFAULT 'uploading' CHECK (upload_status IN ('uploading','uploaded','failed')),
  verification_status text NOT NULL DEFAULT 'none' CHECK (verification_status IN ('none','server_ok','full_ok','failed')),
  uploaded_at         timestamptz,
  verified_at         timestamptz,
  PRIMARY KEY (store_id, backup_id)
);
CREATE INDEX ix_manifests_store_time ON backup.manifests(store_id, client_created_at DESC);
CREATE TABLE backup.upload_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL,
  backup_id     text NOT NULL,
  device_id     uuid NOT NULL REFERENCES cloud.devices(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_chunk_at timestamptz,
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished','abandoned')),
  FOREIGN KEY (store_id, backup_id) REFERENCES backup.manifests(store_id, backup_id) ON DELETE CASCADE
);
CREATE TABLE backup.chunks (
  store_id  uuid NOT NULL,
  backup_id text NOT NULL,
  idx       integer NOT NULL CHECK (idx >= 0),
  sha256    text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes     integer NOT NULL CHECK (bytes > 0),
  data      bytea NOT NULL,
  PRIMARY KEY (store_id, backup_id, idx),
  FOREIGN KEY (store_id, backup_id) REFERENCES backup.manifests(store_id, backup_id) ON DELETE CASCADE
);
CREATE TABLE backup.verifications (
  id        bigserial PRIMARY KEY,
  store_id  uuid NOT NULL,
  backup_id text NOT NULL,
  device_id uuid,
  kind      text NOT NULL CHECK (kind IN ('server','full')),
  ok        boolean NOT NULL,
  detail    text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_verifications ON backup.verifications(store_id, backup_id);
CREATE TABLE backup.retention_log (
  id        bigserial PRIMARY KEY,
  store_id  uuid NOT NULL,
  backup_id text NOT NULL,
  bytes     bigint NOT NULL,
  reason    text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backup.restore_history (
  id        bigserial PRIMARY KEY,
  store_id  uuid NOT NULL,
  backup_id text NOT NULL,
  device_id uuid,
  status    text NOT NULL CHECK (status IN ('downloaded','restored','failed')),
  detail    text,
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync.events (
  event_id    uuid PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES cloud.stores(id),
  device_id   uuid NOT NULL REFERENCES cloud.devices(id),
  kind        text NOT NULL,
  snap_key    text NOT NULL,
  version     integer NOT NULL,
  applied     boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sync_events_time ON sync.events(received_at);

-- The two dashboards read identical shapes from separate schemas.
CREATE TABLE readmodel.snapshots (
  store_id          uuid NOT NULL,
  kind              text NOT NULL,
  snap_key          text NOT NULL,
  version           integer NOT NULL CHECK (version > 0),
  payload           jsonb NOT NULL,
  source_created_at timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, kind, snap_key)
);
CREATE TABLE readmodel.status (
  store_id        uuid PRIMARY KEY,
  store_name      text NOT NULL,
  device_name     text,
  app_version     text,
  last_success_at timestamptz,
  last_data_at    timestamptz,
  today           text
);
CREATE TABLE demo.snapshots (LIKE readmodel.snapshots INCLUDING ALL);
CREATE TABLE demo.status (LIKE readmodel.status INCLUDING ALL);

CREATE TABLE dash_auth.users (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 40),
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('real','demo')),
  store_id      uuid NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dash_auth.sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES dash_auth.users(id) ON DELETE CASCADE,
  scope      text NOT NULL CHECK (scope IN ('real','demo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX ix_sessions_user ON dash_auth.sessions(user_id);
CREATE TABLE dash_auth.login_attempts (
  id  bigserial PRIMARY KEY,
  key text NOT NULL,
  ok  boolean NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_login_attempts ON dash_auth.login_attempts(key, at);
