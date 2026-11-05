// Customer credit (accounts receivable) and supplier payment allocation (accounts payable).
// PROVISIONAL accounting until the accountant approves (docs/audit/CREDIT_MANAGEMENT_AUDIT.md §7, §9).
//
// The payments table is rebuilt only to allow the tender 'account' (the part of a sale left on the customer's
// account). SQLite cannot change a CHECK constraint in place. Every row is copied and the copy is verified before
// the old table is dropped; this whole migration runs in one transaction and an encrypted snapshot is taken first.

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
-- ── payments: allow tender 'account' ────────────────────────
CREATE TABLE payments_new (
  id        INTEGER PRIMARY KEY,
  sale_id   INTEGER NOT NULL REFERENCES sales(id),
  tender    TEXT NOT NULL CHECK (tender IN ('cash','card','account')),
  amount    INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT
) STRICT;
INSERT INTO payments_new (id, sale_id, tender, amount, reference) SELECT id, sale_id, tender, amount, reference FROM payments;
CREATE TEMP TABLE _copy_check (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _copy_check SELECT (SELECT count(*) FROM payments_new) = (SELECT count(*) FROM payments)
  AND (SELECT COALESCE(SUM(amount),0) FROM payments_new) = (SELECT COALESCE(SUM(amount),0) FROM payments);
DROP TABLE _copy_check;
DROP TRIGGER trg_payments_no_update;
DROP TRIGGER trg_payments_no_delete;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX ix_payments_sale ON payments(sale_id);
${immutable('payments')}

-- ── accounts, permissions ──────────────────────────────────
INSERT INTO accounts (code, name_ar, name_en, type) VALUES
  ('1100', 'ذمم العملاء', 'Accounts receivable (customers)', 'asset'),
  ('1310', 'دفعات مقدمة للموردين', 'Supplier advances', 'asset'),
  ('2300', 'دفعات مقدمة من العملاء', 'Customer advances', 'liability'),
  ('6910', 'ديون معدومة', 'Bad debts written off', 'expense');

INSERT INTO permissions (code, description) VALUES
  ('customer.credit.sell',     'Sell on credit within the customer''s limit'),
  ('customer.credit.override', 'Approve a credit sale above the customer''s limit'),
  ('customer.credit.manage',   'Enable credit, set limits and terms'),
  ('customer.payment.record',  'Record customer payments (cash/card in own shift)'),
  ('customer.payment.bank',    'Record customer bank-transfer payments and apply advances'),
  ('customer.payment.reverse', 'Reverse customer payments'),
  ('customer.writeoff',        'Write off bad debts'),
  ('customer.statements',      'View customer balances, statements and ageing');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin' AND p.code LIKE 'customer.%' AND p.code <> 'customer.manage';
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'supervisor'
    AND p.code IN ('customer.credit.sell','customer.credit.override','customer.payment.record','customer.payment.bank','customer.statements');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'cashier' AND p.code IN ('customer.credit.sell','customer.payment.record');

-- ── customer credit profile ────────────────────────────────
ALTER TABLE customers ADD COLUMN credit_enabled INTEGER NOT NULL DEFAULT 0 CHECK (credit_enabled IN (0,1));
ALTER TABLE customers ADD COLUMN credit_limit INTEGER CHECK (credit_limit IS NULL OR credit_limit >= 0); -- NULL = no fixed limit
ALTER TABLE customers ADD COLUMN payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365); -- NULL = no due date
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN updated_at TEXT;

CREATE TABLE receivables (
  sale_id     INTEGER PRIMARY KEY REFERENCES sales(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),     -- left on account at the sale
  due_date    TEXT,                                    -- NULL = no due date
  override_by INTEGER REFERENCES users(id),            -- supervisor who approved going over the limit
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX ix_receivables_customer ON receivables(customer_id);
${immutable('receivables')}

CREATE TABLE customer_receipts (
  id          INTEGER PRIMARY KEY,
  receipt_no  TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),     -- negative = reversal of reversed_of
  method      TEXT NOT NULL CHECK (method IN ('cash','card','bank')),
  reference   TEXT,
  shift_id    INTEGER REFERENCES register_shifts(id),
  reversed_of INTEGER UNIQUE REFERENCES customer_receipts(id),
  notes       TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  CHECK ((amount < 0) = (reversed_of IS NOT NULL)),
  CHECK (method = 'bank' OR shift_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_customer_receipts_customer ON customer_receipts(customer_id);
CREATE INDEX ix_customer_receipts_shift ON customer_receipts(shift_id);
${immutable('customer_receipts')}

-- Which invoice a receipt settles. Applying an earlier advance is a row with the advance's receipt id.
CREATE TABLE receipt_allocations (
  id         INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES customer_receipts(id),
  sale_id    INTEGER NOT NULL REFERENCES receivables(sale_id),
  amount     INTEGER NOT NULL CHECK (amount <> 0),       -- negative rows undo an allocation when a receipt is reversed
  kind       TEXT NOT NULL CHECK (kind IN ('at_receipt','advance_applied','reversal')),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ix_receipt_alloc_sale ON receipt_allocations(sale_id);
CREATE INDEX ix_receipt_alloc_receipt ON receipt_allocations(receipt_id);
${immutable('receipt_allocations')}

CREATE TABLE customer_writeoffs (
  id          INTEGER PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  sale_id     INTEGER NOT NULL REFERENCES receivables(sale_id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL CHECK (length(reason) > 0),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
${immutable('customer_writeoffs')}

CREATE TABLE refund_account_offsets (
  refund_id INTEGER PRIMARY KEY REFERENCES refunds(id),
  sale_id   INTEGER NOT NULL REFERENCES receivables(sale_id),
  amount    INTEGER NOT NULL CHECK (amount > 0)           -- part of the refund that reduced the debt (no cash paid)
) STRICT;
${immutable('refund_account_offsets')}

CREATE TABLE invoice_disputes (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES receivables(sale_id),
  disputed   INTEGER NOT NULL CHECK (disputed IN (0,1)),  -- latest row per sale is the current state
  note       TEXT NOT NULL CHECK (length(note) > 0),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ix_invoice_disputes_sale ON invoice_disputes(sale_id, id);
${immutable('invoice_disputes')}

-- ── supplier side ──────────────────────────────────────────
ALTER TABLE suppliers ADD COLUMN notes TEXT;
ALTER TABLE suppliers ADD COLUMN address TEXT;
ALTER TABLE purchase_invoices ADD COLUMN no_due_date INTEGER NOT NULL DEFAULT 0 CHECK (no_due_date IN (0,1));
ALTER TABLE purchase_invoices ADD COLUMN arrangement_note TEXT;  -- e.g. "Supplier collects at the next delivery"

-- What settles each supplier invoice or opening balance: a payment, or a return to that supplier.
CREATE TABLE supplier_payment_allocations (
  id          INTEGER PRIMARY KEY,
  payment_id  INTEGER REFERENCES supplier_payments(id),
  return_id   INTEGER REFERENCES purchase_returns(id),
  invoice_id  INTEGER REFERENCES purchase_invoices(id),
  opening_id  INTEGER REFERENCES supplier_opening_balances(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),
  kind        TEXT NOT NULL CHECK (kind IN ('at_payment','advance_applied','return','reversal','backfill')),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  CHECK ((payment_id IS NULL) <> (return_id IS NULL)),
  CHECK ((invoice_id IS NULL) <> (opening_id IS NULL))
) STRICT;
CREATE INDEX ix_spa_payment ON supplier_payment_allocations(payment_id);
CREATE INDEX ix_spa_return ON supplier_payment_allocations(return_id);
CREATE INDEX ix_spa_opening ON supplier_payment_allocations(opening_id);
CREATE INDEX ix_spa_invoice ON supplier_payment_allocations(invoice_id);
${immutable('supplier_payment_allocations')}

INSERT INTO invoice_counters (series, next_value) VALUES ('CRCPT', 1);
INSERT INTO settings (key, value) VALUES ('supplier_allocations_backfilled', '0'), ('credit_due_soon_days', '7');
`;
