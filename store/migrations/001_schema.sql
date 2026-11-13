-- Money is integer halalas and quantity is integer milli-units, as in the POS.
-- Fields copied from the POS are written only by the sync. Nothing here holds a cost price.
CREATE SCHEMA commerce;

CREATE TABLE commerce.catalog_categories (
  pos_category_id bigint PRIMARY KEY,
  name_en         text NOT NULL CHECK (length(name_en) > 0),
  name_ar         text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.catalog_products (
  pos_product_id bigint PRIMARY KEY,
  sku            text NOT NULL UNIQUE,
  name_en        text NOT NULL CHECK (length(name_en) > 0),
  name_ar        text NOT NULL,
  category_id    bigint REFERENCES commerce.catalog_categories(pos_category_id),
  unit           text NOT NULL,
  sell_mode      text NOT NULL CHECK (sell_mode IN ('unit','weight')),
  item_kind      text NOT NULL DEFAULT 'stock' CHECK (item_kind IN ('stock','service')),
  price_incl     integer NOT NULL CHECK (price_incl >= 0),
  vat_rate_bp    integer NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  pos_active     boolean NOT NULL,
  pos_seq        bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_catalog_products_category ON commerce.catalog_products(category_id);
CREATE TABLE commerce.catalog_barcodes (
  barcode        text PRIMARY KEY,
  pos_product_id bigint NOT NULL REFERENCES commerce.catalog_products(pos_product_id)
);
CREATE INDEX ix_catalog_barcodes_product ON commerce.catalog_barcodes(pos_product_id);

CREATE TABLE commerce.product_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_product_id bigint REFERENCES commerce.catalog_products(pos_product_id),
  object_key     text NOT NULL UNIQUE,
  width          integer NOT NULL CHECK (width > 0),
  height         integer NOT NULL CHECK (height > 0),
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  sort           integer NOT NULL DEFAULT 0,
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_product_images_primary ON commerce.product_images(pos_product_id) WHERE is_primary;
CREATE TABLE commerce.web_categories (
  pos_category_id bigint PRIMARY KEY REFERENCES commerce.catalog_categories(pos_category_id),
  sort            integer NOT NULL DEFAULT 0,
  image_id        uuid REFERENCES commerce.product_images(id),
  visible         boolean NOT NULL DEFAULT true
);
CREATE TABLE commerce.web_products (
  pos_product_id bigint PRIMARY KEY REFERENCES commerce.catalog_products(pos_product_id),
  description    text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'unpublished' CHECK (status IN ('unpublished','published','archived')),
  featured       boolean NOT NULL DEFAULT false,
  safety_stock   integer NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  updated_by     bigint,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.product_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  barcode               text,
  note                  text NOT NULL DEFAULT '',
  state                 text NOT NULL DEFAULT 'open' CHECK (state IN ('open','completed','declined')),
  linked_pos_product_id bigint REFERENCES commerce.catalog_products(pos_product_id),
  requested_by          bigint,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.banners (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title    text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body     text NOT NULL DEFAULT '',
  image_id uuid REFERENCES commerce.product_images(id),
  link     text,
  active   boolean NOT NULL DEFAULT false,
  sort     integer NOT NULL DEFAULT 0
);

CREATE TABLE commerce.inventory_positions (
  pos_product_id bigint PRIMARY KEY REFERENCES commerce.catalog_products(pos_product_id),
  on_hand        integer NOT NULL,
  reserved       integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  applied_seq    bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.delivery_areas (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 120),
  fee_incl integer CHECK (fee_incl >= 0),
  active   boolean NOT NULL DEFAULT true
);
CREATE TABLE commerce.store_settings (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  delivery_fee_incl       integer CHECK (delivery_fee_incl >= 0),
  delivery_vat_bp         integer NOT NULL DEFAULT 1500 CHECK (delivery_vat_bp BETWEEN 0 AND 10000),
  free_delivery_threshold integer NOT NULL DEFAULT 5000 CHECK (free_delivery_threshold >= 0),
  free_delivery_basis     text NOT NULL DEFAULT 'after_discount_before_vat' CHECK (free_delivery_basis IN ('after_discount_before_vat','after_discount_incl_vat')),
  stale_minutes           integer NOT NULL DEFAULT 15 CHECK (stale_minutes BETWEEN 1 AND 1440),
  pay_minutes             integer NOT NULL DEFAULT 15 CHECK (pay_minutes BETWEEN 1 AND 1440),
  accept_minutes          integer NOT NULL DEFAULT 30 CHECK (accept_minutes BETWEEN 1 AND 1440),
  expiry_pause_hours      integer NOT NULL DEFAULT 4 CHECK (expiry_pause_hours BETWEEN 0 AND 72),
  opening_hours           jsonb NOT NULL DEFAULT '[]',
  payment_methods         text[] NOT NULL DEFAULT ARRAY['pay_at_pickup'],
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO commerce.store_settings (id) VALUES (1);

CREATE TABLE commerce.orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref         text NOT NULL UNIQUE,
  access_token_hash  text NOT NULL,
  idempotency_key    text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','accepted','preparing','ready_for_pickup','out_for_delivery','completed','rejected','cancelled','expired')),
  fulfilment         text NOT NULL CHECK (fulfilment IN ('delivery','pickup')),
  customer_name      text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 120),
  phone              text NOT NULL CHECK (length(phone) BETWEEN 5 AND 20),
  area_id            uuid REFERENCES commerce.delivery_areas(id),
  address_line       text,
  building           text,
  location_note      text,
  lat                double precision,
  lng                double precision,
  pickup_slot        text,
  items_incl         integer NOT NULL CHECK (items_incl >= 0),
  discount_total     integer NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  eligible_subtotal  integer NOT NULL CHECK (eligible_subtotal >= 0),
  delivery_fee_incl  integer NOT NULL DEFAULT 0 CHECK (delivery_fee_incl >= 0),
  total_incl         integer NOT NULL CHECK (total_incl >= 0),
  total_vat          integer NOT NULL CHECK (total_vat >= 0),
  assigned_staff     bigint,
  pos_invoice_no     text,
  version            integer NOT NULL DEFAULT 1,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (total_incl = items_incl + delivery_fee_incl),
  CHECK (fulfilment = 'pickup' OR (area_id IS NOT NULL AND address_line IS NOT NULL)),
  CHECK (fulfilment = 'delivery' OR (area_id IS NULL AND address_line IS NULL AND building IS NULL AND lat IS NULL AND lng IS NULL AND delivery_fee_incl = 0))
);
CREATE INDEX ix_orders_status ON commerce.orders(status, created_at);
CREATE TABLE commerce.order_lines (
  order_id        uuid NOT NULL REFERENCES commerce.orders(id),
  line_no         integer NOT NULL CHECK (line_no > 0),
  pos_product_id  bigint NOT NULL REFERENCES commerce.catalog_products(pos_product_id),
  sku             text NOT NULL,
  name            text NOT NULL,
  qty             integer NOT NULL CHECK (qty > 0),
  unit_price_incl integer NOT NULL CHECK (unit_price_incl >= 0),
  discount        integer NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_rate_bp     integer NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  line_incl       integer NOT NULL CHECK (line_incl >= 0),
  line_vat        integer NOT NULL CHECK (line_vat >= 0),
  is_estimate     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (order_id, line_no)
);
CREATE TABLE commerce.order_status_history (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES commerce.orders(id),
  from_status text,
  to_status   text NOT NULL,
  staff_id    bigint,
  actor       text NOT NULL CHECK (actor IN ('staff','customer','system','pos')),
  reason      text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_history ON commerce.order_status_history(order_id, at);

CREATE TABLE commerce.reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES commerce.orders(id),
  pos_product_id bigint NOT NULL REFERENCES commerce.inventory_positions(pos_product_id),
  qty            integer NOT NULL CHECK (qty > 0),
  state          text NOT NULL DEFAULT 'active' CHECK (state IN ('active','consumed','released')),
  expires_at     timestamptz,
  release_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, pos_product_id)
);
CREATE INDEX ix_reservations_active ON commerce.reservations(pos_product_id) WHERE state = 'active';
CREATE TABLE commerce.stock_discrepancies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_product_id bigint NOT NULL REFERENCES commerce.catalog_products(pos_product_id),
  kind           text NOT NULL CHECK (kind IN ('checkpoint','shortage','reservation_sum')),
  expected       integer NOT NULL,
  actual         integer NOT NULL,
  seq            bigint,
  order_id       uuid REFERENCES commerce.orders(id),
  state          text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  resolved_by    bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES commerce.orders(id),
  method          text NOT NULL CHECK (method IN ('card','mada','apple_pay','stc_pay','pay_at_pickup','cash_on_delivery')),
  status          text NOT NULL CHECK (status IN ('pending','authorized','paid','failed','cancelled','due_at_pickup','due_on_delivery','refund_pending','refunded','partially_refunded')),
  amount          integer NOT NULL CHECK (amount >= 0),
  amount_captured integer NOT NULL DEFAULT 0 CHECK (amount_captured >= 0),
  provider        text,
  provider_ref    text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_payments_order ON commerce.payments(order_id);
CREATE TABLE commerce.payment_events (
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  payload           jsonb NOT NULL,
  verified_at       timestamptz NOT NULL DEFAULT now(),
  applied_at        timestamptz,
  PRIMARY KEY (provider, provider_event_id)
);
CREATE TABLE commerce.refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES commerce.orders(id),
  payment_id    uuid NOT NULL REFERENCES commerce.payments(id),
  amount        integer NOT NULL CHECK (amount > 0),
  reason        text NOT NULL CHECK (length(reason) > 0),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  provider_ref  text UNIQUE,
  approved_by   bigint NOT NULL,
  pos_refund_no text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.staff_roles (
  code text PRIMARY KEY
);
CREATE TABLE commerce.permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE commerce.staff_role_permissions (
  role       text NOT NULL REFERENCES commerce.staff_roles(code),
  permission text NOT NULL REFERENCES commerce.permissions(code),
  PRIMARY KEY (role, permission)
);
CREATE TABLE commerce.staff_users (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 40),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  role          text NOT NULL REFERENCES commerce.staff_roles(code),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.staff_sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES commerce.staff_users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.login_attempts (
  id  bigserial PRIMARY KEY,
  key text NOT NULL,
  ok  boolean NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_login_attempts ON commerce.login_attempts(key, at);
CREATE TABLE commerce.audit_log (
  id        bigserial PRIMARY KEY,
  actor     text NOT NULL CHECK (actor IN ('staff','customer','system','device')),
  actor_id  text,
  action    text NOT NULL,
  entity    text,
  entity_id text,
  detail    jsonb NOT NULL DEFAULT '{}',
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_at ON commerce.audit_log(at);

CREATE TABLE commerce.enrollment_codes (
  code_hash  text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE TABLE commerce.devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  secret_hash  text NOT NULL,
  app_version  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  epoch        bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  acked_seq    bigint NOT NULL DEFAULT 0 CHECK (acked_seq >= 0),
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.sync_inbox (
  event_id    text PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES commerce.devices(id),
  epoch       bigint NOT NULL,
  seq         bigint NOT NULL,
  type        text NOT NULL,
  version     integer NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'received' CHECK (status IN ('received','applied','parked')),
  error       text,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  UNIQUE (device_id, epoch, seq)
);
CREATE TABLE commerce.pos_commands (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acked_at   timestamptz
);
CREATE TABLE commerce.idempotency_keys (
  key          text PRIMARY KEY,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce.rate_limits (
  id  bigserial PRIMARY KEY,
  key text NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rate_limits ON commerce.rate_limits(key, at);

INSERT INTO commerce.staff_roles (code) VALUES ('admin'), ('supervisor'), ('cashier');
INSERT INTO commerce.permissions (code, description) VALUES
  ('orders.view', 'See online orders'),
  ('orders.accept', 'Accept online orders'),
  ('orders.reject', 'Reject or cancel online orders'),
  ('orders.fulfil', 'Move orders through preparation and delivery'),
  ('products.edit', 'Edit website descriptions and photos'),
  ('products.publish', 'Publish, unpublish and archive products'),
  ('stock.view', 'See stock and sync health'),
  ('stock.override', 'Resolve stock discrepancies and release reservations'),
  ('payments.view', 'See payment details'),
  ('refunds.approve', 'Approve online refunds'),
  ('delivery.manage', 'Manage delivery assignments and areas'),
  ('settings.manage', 'Change store settings');
INSERT INTO commerce.staff_role_permissions (role, permission) SELECT 'admin', code FROM commerce.permissions;
INSERT INTO commerce.staff_role_permissions (role, permission) SELECT 'supervisor', code FROM commerce.permissions WHERE code NOT IN ('stock.override','settings.manage');
INSERT INTO commerce.staff_role_permissions (role, permission) VALUES ('cashier','orders.view'), ('cashier','orders.fulfil'), ('cashier','stock.view');
