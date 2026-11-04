// Phase 1 schema. Conventions (plan §F):
//  - money: INTEGER halalas; quantities: INTEGER milli-units; rates: basis points
//  - timestamps: UTC ISO-8601 TEXT
//  - finalized business records are immutable (triggers below); corrections are new records

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- ── Security ────────────────────────────────────────────────
CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  pin_salt     TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at   TEXT NOT NULL
) STRICT;

CREATE TABLE roles (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
) STRICT;

CREATE TABLE role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
) STRICT;

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
) STRICT;

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  details_json TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE
) STRICT;
${immutable('audit_log')}

-- ── Catalog ─────────────────────────────────────────────────
CREATE TABLE units (
  id      INTEGER PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  measure TEXT NOT NULL CHECK (measure IN ('piece','weight'))
) STRICT;

CREATE TABLE categories (
  id      INTEGER PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL
) STRICT;

CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL CHECK (length(name_ar) > 0),
  name_en       TEXT NOT NULL CHECK (length(name_en) > 0),
  category_id   INTEGER REFERENCES categories(id),
  unit_id       INTEGER NOT NULL REFERENCES units(id),
  sell_mode     TEXT NOT NULL CHECK (sell_mode IN ('unit','weight')),
  vat_rate_bp   INTEGER NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  price_incl    INTEGER NOT NULL CHECK (price_incl >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;
CREATE INDEX ix_products_name_en ON products(name_en);
CREATE INDEX ix_products_name_ar ON products(name_ar);

CREATE TABLE product_barcodes (
  barcode      TEXT PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  qty_per_scan INTEGER NOT NULL DEFAULT 1000 CHECK (qty_per_scan > 0)
) STRICT;
CREATE INDEX ix_barcodes_product ON product_barcodes(product_id);

CREATE TABLE plu_codes (
  plu        TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id)
) STRICT;

CREATE TABLE price_history (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  old_price  INTEGER,
  new_price  INTEGER NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL
) STRICT;
${immutable('price_history')}

CREATE TABLE scale_barcode_formats (
  id           INTEGER PRIMARY KEY,
  prefix       TEXT NOT NULL UNIQUE,
  item_digits  INTEGER NOT NULL,
  value_digits INTEGER NOT NULL,
  embedded     TEXT NOT NULL CHECK (embedded IN ('weight','price')),
  CHECK (length(prefix) + item_digits + value_digits = 12)
) STRICT;

-- ── Parties ─────────────────────────────────────────────────
CREATE TABLE customers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE,
  vat_number TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE suppliers (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  phone              TEXT,
  vat_number         TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at         TEXT NOT NULL
) STRICT;

-- ── Shifts ──────────────────────────────────────────────────
CREATE TABLE register_shifts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  opened_at     TEXT NOT NULL,
  opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
  status        TEXT NOT NULL CHECK (status IN ('open','closed')),
  closed_at     TEXT,
  closed_by     INTEGER REFERENCES users(id),
  expected_cash INTEGER,
  counted_cash  INTEGER,
  CHECK ((status = 'open') = (closed_at IS NULL))
) STRICT;
-- One cash register: at most one open shift at a time.
CREATE UNIQUE INDEX ux_one_open_shift ON register_shifts(status) WHERE status = 'open';
CREATE TRIGGER trg_shift_closed_is_final BEFORE UPDATE ON register_shifts
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, 'closed shift is immutable'); END;
CREATE TRIGGER trg_register_shifts_no_delete BEFORE DELETE ON register_shifts
BEGIN SELECT RAISE(ABORT, 'register_shifts is immutable'); END;

CREATE TABLE cash_movements (
  id       INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES register_shifts(id),
  kind     TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount   INTEGER NOT NULL CHECK (amount > 0),
  reason   TEXT NOT NULL CHECK (length(reason) > 0),
  user_id  INTEGER NOT NULL REFERENCES users(id),
  at       TEXT NOT NULL
) STRICT;
${immutable('cash_movements')}

CREATE TABLE held_bills (
  id           INTEGER PRIMARY KEY,
  label        TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL
) STRICT;

-- ── Sales ───────────────────────────────────────────────────
CREATE TABLE invoice_counters (
  series     TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value > 0)
) STRICT;

CREATE TABLE sales (
  id              INTEGER PRIMARY KEY,
  invoice_no      TEXT NOT NULL UNIQUE,
  uuid            TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  shift_id        INTEGER NOT NULL REFERENCES register_shifts(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  customer_id     INTEGER REFERENCES customers(id),
  total_incl      INTEGER NOT NULL CHECK (total_incl >= 0),
  total_vat       INTEGER NOT NULL CHECK (total_vat >= 0),
  total_excl      INTEGER NOT NULL,
  total_discount  INTEGER NOT NULL CHECK (total_discount >= 0),
  paid_total      INTEGER NOT NULL,
  change_given    INTEGER NOT NULL CHECK (change_given >= 0),
  discount_approved_by INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  CHECK (total_excl + total_vat = total_incl),
  CHECK (paid_total - change_given = total_incl)
) STRICT;
CREATE INDEX ix_sales_shift ON sales(shift_id);
CREATE INDEX ix_sales_created ON sales(created_at);
${immutable('sales')}

CREATE TABLE sale_lines (
  sale_id         INTEGER NOT NULL REFERENCES sales(id),
  line_no         INTEGER NOT NULL,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_price_incl INTEGER NOT NULL CHECK (unit_price_incl >= 0),
  discount        INTEGER NOT NULL CHECK (discount >= 0),
  vat_rate_bp     INTEGER NOT NULL,
  line_incl       INTEGER NOT NULL,
  line_vat        INTEGER NOT NULL,
  line_excl       INTEGER NOT NULL,
  unit_cost       INTEGER NOT NULL,
  PRIMARY KEY (sale_id, line_no),
  CHECK (line_excl + line_vat = line_incl)
) STRICT;
${immutable('sale_lines')}

CREATE TABLE payments (
  id        INTEGER PRIMARY KEY,
  sale_id   INTEGER NOT NULL REFERENCES sales(id),
  tender    TEXT NOT NULL CHECK (tender IN ('cash','card')),
  amount    INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT
) STRICT;
CREATE INDEX ix_payments_sale ON payments(sale_id);
${immutable('payments')}

-- ── Inventory ───────────────────────────────────────────────
CREATE TABLE stock_movements (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0),
  reason      TEXT NOT NULL CHECK (reason IN ('sale','refund','grn','purchase_return','waste','count_adj','opening')),
  source_type TEXT NOT NULL,
  source_id   INTEGER NOT NULL,
  source_line INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  at          TEXT NOT NULL,
  UNIQUE (source_type, source_id, source_line)
) STRICT;
CREATE INDEX ix_stock_product ON stock_movements(product_id);
${immutable('stock_movements')}

CREATE TABLE stock_balances (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  qty        INTEGER NOT NULL,
  avg_cost   INTEGER NOT NULL CHECK (avg_cost >= 0)
) STRICT;

CREATE TABLE goods_receipts (
  id          INTEGER PRIMARY KEY,
  grn_no      TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  reference   TEXT,
  total_cost  INTEGER NOT NULL CHECK (total_cost >= 0),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL
) STRICT;
${immutable('goods_receipts')}

CREATE TABLE grn_lines (
  grn_id     INTEGER NOT NULL REFERENCES goods_receipts(id),
  line_no    INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_cost  INTEGER NOT NULL CHECK (unit_cost >= 0),
  PRIMARY KEY (grn_id, line_no)
) STRICT;
${immutable('grn_lines')}

-- ── Accounting (engine only; chart of accounts is a DRAFT until the accountant approves) ──
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1))
) STRICT;

CREATE TABLE journal_entries (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id   INTEGER NOT NULL,
  memo        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (source_type, source_id)
) STRICT;
${immutable('journal_entries')}

CREATE TABLE journal_lines (
  id         INTEGER PRIMARY KEY,
  entry_id   INTEGER NOT NULL REFERENCES journal_entries(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit      INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit     INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0))
) STRICT;
CREATE INDEX ix_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX ix_journal_lines_account ON journal_lines(account_id);
${immutable('journal_lines')}

-- ── Seed data ───────────────────────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('negative_stock_policy', 'allow'),
  ('store_name_ar', ''),
  ('store_name_en', ''),
  ('store_vat_number', ''),
  ('coa_status', 'draft-pending-accountant');

INSERT INTO units (code, name_ar, name_en, measure) VALUES
  ('PCS', 'حبة', 'Piece', 'piece'),
  ('KG',  'كيلو', 'Kilogram', 'weight');

INSERT INTO invoice_counters (series, next_value) VALUES ('SALE', 1), ('GRN', 1);

INSERT INTO permissions (code, description) VALUES
  ('sale.create',     'Ring up and finalize sales'),
  ('sale.discount',   'Apply or approve discounts'),
  ('sale.refund',     'Approve refunds'),
  ('shift.open',      'Open a register shift'),
  ('shift.close',     'Close a register shift'),
  ('cash.move',       'Record cash in/out'),
  ('drawer.open',     'Open drawer without a sale'),
  ('product.manage',  'Create and edit products and prices'),
  ('stock.receive',   'Receive goods'),
  ('stock.adjust',    'Adjust stock and record wastage'),
  ('supplier.manage', 'Create and edit suppliers'),
  ('customer.manage', 'Create and edit customers'),
  ('reports.view',    'View reports'),
  ('user.manage',     'Manage users and roles'),
  ('settings.manage', 'Change settings'),
  ('backup.run',      'Run a manual backup'),
  ('backup.restore',  'Restore from backup');

INSERT INTO roles (code, name) VALUES ('admin', 'Administrator'), ('supervisor', 'Supervisor'), ('cashier', 'Cashier');

INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin';
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.code = 'supervisor' AND p.code NOT IN ('user.manage', 'settings.manage', 'backup.restore');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.code = 'cashier' AND p.code IN ('sale.create', 'shift.open', 'shift.close', 'customer.manage');

-- DRAFT chart of accounts: placeholders so postings balance; the accountant must approve or replace.
INSERT INTO accounts (code, name_ar, name_en, type) VALUES
  ('1010', 'النقدية في الصندوق', 'Cash on hand', 'asset'),
  ('1020', 'مقاصة البطاقات', 'Card clearing', 'asset'),
  ('1200', 'المخزون', 'Inventory', 'asset'),
  ('2000', 'الدائنون', 'Accounts payable', 'liability'),
  ('2100', 'بضاعة مستلمة لم تفوتر', 'Goods received not invoiced', 'liability'),
  ('2200', 'ضريبة القيمة المضافة المستحقة', 'VAT output payable', 'liability'),
  ('2210', 'ضريبة القيمة المضافة القابلة للاسترداد', 'VAT input recoverable', 'asset'),
  ('3000', 'حقوق الملكية الافتتاحية', 'Opening balance equity', 'equity'),
  ('4000', 'إيرادات المبيعات', 'Sales revenue', 'income'),
  ('5000', 'تكلفة البضاعة المباعة', 'Cost of goods sold', 'expense'),
  ('5100', 'التالف والهدر', 'Wastage and shrinkage', 'expense'),
  ('6000', 'عجز وزيادة الصندوق', 'Cash over/short', 'expense');
`;
