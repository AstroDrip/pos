// Purchasing (plan Phase 4): supplier invoices matched to goods receipts, returns to supplier, supplier payments,
// supplier opening balances. PROVISIONAL posting rules until the accountant approves. New tables and one new
// account only; existing GRNs keep their meaning (Dr Inventory / Cr 2100 Goods received not invoiced).

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
INSERT INTO accounts (code, name_ar, name_en, type) VALUES
  ('5010', 'فروقات أسعار الشراء', 'Purchase price differences', 'expense');

INSERT INTO permissions (code, description) VALUES
  ('purchase.view',   'View supplier invoices, balances and ageing'),
  ('purchase.manage', 'Enter supplier invoices, returns and supplier opening balances'),
  ('purchase.pay',    'Record and reverse supplier payments');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin' AND p.code IN ('purchase.view','purchase.manage','purchase.pay');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'supervisor' AND p.code IN ('purchase.view');

CREATE TABLE purchase_invoices (
  id                  INTEGER PRIMARY KEY,
  pinv_no             TEXT NOT NULL UNIQUE,
  request_key         TEXT NOT NULL UNIQUE,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_invoice_no TEXT NOT NULL CHECK (length(supplier_invoice_no) > 0),
  supplier_vat_no     TEXT,
  invoice_date        TEXT NOT NULL,
  due_date            TEXT NOT NULL,
  goods_net           INTEGER NOT NULL CHECK (goods_net >= 0),  -- value of the matched goods receipts (cost excl. VAT)
  invoice_net         INTEGER NOT NULL CHECK (invoice_net > 0),  -- net amount on the supplier invoice
  vat_amount          INTEGER NOT NULL CHECK (vat_amount >= 0),
  vat_recoverable     INTEGER NOT NULL CHECK (vat_recoverable IN (0,1)),
  gross               INTEGER NOT NULL,
  difference_reason   TEXT,
  notes               TEXT,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL,
  CHECK (gross = invoice_net + vat_amount),
  CHECK (vat_recoverable = 0 OR vat_amount > 0),
  UNIQUE (supplier_id, supplier_invoice_no)
) STRICT;
CREATE INDEX ix_pinv_supplier ON purchase_invoices(supplier_id, due_date);
CREATE INDEX ix_pinv_date ON purchase_invoices(invoice_date);
${immutable('purchase_invoices')}

CREATE TABLE purchase_invoice_grns (
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id),
  grn_id     INTEGER NOT NULL UNIQUE REFERENCES goods_receipts(id),  -- a goods receipt is invoiced once
  PRIMARY KEY (invoice_id, grn_id)
) STRICT;
${immutable('purchase_invoice_grns')}

CREATE TABLE purchase_returns (
  id                  INTEGER PRIMARY KEY,
  pret_no             TEXT NOT NULL UNIQUE,
  request_key         TEXT NOT NULL UNIQUE,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_credit_ref TEXT,
  return_date         TEXT NOT NULL,
  stock_value         INTEGER NOT NULL CHECK (stock_value >= 0),  -- stock taken out, at average cost
  credit_net          INTEGER NOT NULL CHECK (credit_net >= 0),   -- net credit agreed with the supplier
  vat_amount          INTEGER NOT NULL CHECK (vat_amount >= 0),
  vat_recoverable     INTEGER NOT NULL CHECK (vat_recoverable IN (0,1)),
  gross               INTEGER NOT NULL CHECK (gross > 0),
  reason              TEXT NOT NULL CHECK (length(reason) > 0),
  user_id             INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL,
  CHECK (gross = credit_net + vat_amount)
) STRICT;
CREATE INDEX ix_pret_supplier ON purchase_returns(supplier_id);
${immutable('purchase_returns')}

CREATE TABLE purchase_return_lines (
  return_id  INTEGER NOT NULL REFERENCES purchase_returns(id),
  line_no    INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_cost  INTEGER NOT NULL CHECK (unit_cost >= 0),
  value      INTEGER NOT NULL CHECK (value >= 0),
  PRIMARY KEY (return_id, line_no)
) STRICT;
${immutable('purchase_return_lines')}

CREATE TABLE supplier_payments (
  id          INTEGER PRIMARY KEY,
  pay_no      TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),   -- negative = reversal of reversed_of
  method      TEXT NOT NULL CHECK (method IN ('bank','till')),
  paid_on     TEXT NOT NULL,
  reference   TEXT,
  shift_id    INTEGER REFERENCES register_shifts(id),
  reversed_of INTEGER UNIQUE REFERENCES supplier_payments(id),
  reason      TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  CHECK ((amount < 0) = (reversed_of IS NOT NULL)),
  CHECK (method <> 'till' OR shift_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_spay_supplier ON supplier_payments(supplier_id);
CREATE INDEX ix_spay_shift ON supplier_payments(shift_id);
${immutable('supplier_payments')}

CREATE TABLE supplier_opening_balances (
  id          INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL UNIQUE REFERENCES suppliers(id),   -- once per supplier
  amount      INTEGER NOT NULL CHECK (amount > 0),               -- owed to the supplier on the start day
  as_of       TEXT NOT NULL,
  reference   TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
${immutable('supplier_opening_balances')}

INSERT INTO invoice_counters (series, next_value) VALUES ('PINV', 1), ('PRET', 1), ('SPAY', 1);
`;
