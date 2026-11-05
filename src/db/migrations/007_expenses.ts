// Store expenses with real accounting (ADR-4). PROVISIONAL chart additions: the accountant must approve them.
// Only NEW accounts are added; no existing account changes meaning, no historical journal is touched.

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
INSERT INTO accounts (code, name_ar, name_en, type) VALUES
  ('1030', 'البنك', 'Bank', 'asset'),
  ('1300', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses', 'asset'),
  ('1500', 'المعدات', 'Equipment (capital purchases)', 'asset'),
  ('2010', 'مصروفات مستحقة الدفع', 'Accrued expenses payable', 'liability'),
  ('6100', 'الإيجار', 'Rent', 'expense'),
  ('6110', 'الكهرباء', 'Electricity', 'expense'),
  ('6120', 'المياه', 'Water', 'expense'),
  ('6130', 'الإنترنت والهاتف', 'Internet and telephone', 'expense'),
  ('6200', 'الرواتب والأجور', 'Salaries and wages', 'expense'),
  ('6300', 'النظافة', 'Cleaning', 'expense'),
  ('6310', 'الصيانة والإصلاحات', 'Maintenance and repairs', 'expense'),
  ('6400', 'النقل', 'Transport', 'expense'),
  ('6410', 'التغليف', 'Packaging', 'expense'),
  ('6420', 'الأمن', 'Security', 'expense'),
  ('6430', 'اشتراكات البرامج', 'Software subscriptions', 'expense'),
  ('6500', 'رسوم بنكية', 'Bank charges', 'expense'),
  ('6900', 'مصروفات تشغيلية أخرى', 'Other operating expenses', 'expense');

INSERT INTO permissions (code, description) VALUES
  ('expense.view',    'View store expenses'),
  ('expense.create',  'Create and edit draft expenses'),
  ('expense.approve', 'Approve (post) expenses and manage recurring expenses and categories'),
  ('expense.pay',     'Record expense payments'),
  ('expense.reverse', 'Reverse posted expenses and payments'),
  ('finance.view',    'View profit and loss, balance sheet, ledger');
-- Owner (admin) gets everything. Supervisors may view and prepare drafts; posting and paying stay with the owner.
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.code = 'admin' AND p.code IN ('expense.view','expense.create','expense.approve','expense.pay','expense.reverse','finance.view');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.code = 'supervisor' AND p.code IN ('expense.view','expense.create');

CREATE TABLE expense_categories (
  id           INTEGER PRIMARY KEY,
  name_en      TEXT NOT NULL UNIQUE CHECK (length(name_en) > 0),
  name_ar      TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  kind         TEXT NOT NULL DEFAULT 'operating' CHECK (kind IN ('operating','capital')),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;
INSERT INTO expense_categories (name_en, name_ar, account_code, kind) VALUES
  ('Rent', 'الإيجار', '6100', 'operating'),
  ('Electricity', 'الكهرباء', '6110', 'operating'),
  ('Water', 'المياه', '6120', 'operating'),
  ('Internet', 'الإنترنت', '6130', 'operating'),
  ('Telephone', 'الهاتف', '6130', 'operating'),
  ('Salaries', 'الرواتب', '6200', 'operating'),
  ('Cleaning', 'النظافة', '6300', 'operating'),
  ('Maintenance and repairs', 'الصيانة والإصلاحات', '6310', 'operating'),
  ('Transport', 'النقل', '6400', 'operating'),
  ('Packaging', 'التغليف', '6410', 'operating'),
  ('Security', 'الأمن', '6420', 'operating'),
  ('Software subscriptions', 'اشتراكات البرامج', '6430', 'operating'),
  ('Bank charges', 'رسوم بنكية', '6500', 'operating'),
  ('Other operating expenses', 'مصروفات أخرى', '6900', 'operating'),
  ('Equipment purchase (capital)', 'شراء معدات (رأسمالي)', '1500', 'capital');

CREATE TABLE recurring_expenses (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) > 0),
  category_id     INTEGER NOT NULL REFERENCES expense_categories(id),
  expected_gross  INTEGER NOT NULL CHECK (expected_gross > 0),
  variable_amount INTEGER NOT NULL CHECK (variable_amount IN (0,1)),
  interval        TEXT NOT NULL CHECK (interval IN ('monthly','quarterly','yearly')),
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  due_day         INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  payee           TEXT,
  vat_class       TEXT NOT NULL CHECK (vat_class IN ('standard','zero','exempt','out_of_scope')),
  vat_recoverable INTEGER NOT NULL CHECK (vat_recoverable IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;

CREATE TABLE expenses (
  id               INTEGER PRIMARY KEY,
  expense_no       TEXT NOT NULL UNIQUE,
  request_key      TEXT NOT NULL UNIQUE,
  category_id      INTEGER NOT NULL REFERENCES expense_categories(id),
  description      TEXT NOT NULL CHECK (length(description) > 0),
  payee            TEXT,
  invoice_ref      TEXT,
  supplier_vat_no  TEXT,
  notes            TEXT,
  attachment_ref   TEXT,
  currency         TEXT NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  expense_date     TEXT NOT NULL,           -- recognition date (Saudi business day)
  due_date         TEXT,
  period_start     TEXT,                    -- 'YYYY-MM': service period for prepaid expenses
  period_end       TEXT,
  gross            INTEGER NOT NULL CHECK (gross > 0),
  vat_class        TEXT NOT NULL CHECK (vat_class IN ('standard','zero','exempt','out_of_scope')),
  vat_amount       INTEGER NOT NULL CHECK (vat_amount >= 0 AND vat_amount <= gross),
  vat_recoverable  INTEGER NOT NULL CHECK (vat_recoverable IN (0,1)),
  amount_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (amount_confirmed IN (0,1)),
  status           TEXT NOT NULL CHECK (status IN ('draft','posted','cancelled','reversed')),
  recurring_id     INTEGER REFERENCES recurring_expenses(id),
  recurring_period TEXT,
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  posted_by        INTEGER REFERENCES users(id),
  posted_at        TEXT,
  closed_by        INTEGER REFERENCES users(id),   -- who cancelled (draft) or reversed (posted)
  closed_at        TEXT,
  close_reason     TEXT,
  CHECK (vat_class = 'standard' OR (vat_amount = 0 AND vat_recoverable = 0)),
  CHECK ((period_start IS NULL) = (period_end IS NULL)),
  UNIQUE (recurring_id, recurring_period)
) STRICT;
CREATE INDEX ix_expenses_date ON expenses(expense_date);
CREATE INDEX ix_expenses_status ON expenses(status);
CREATE INDEX ix_expenses_category ON expenses(category_id);
-- Posted, cancelled and reversed expenses keep their amounts forever; only drafts can be edited.
CREATE TRIGGER trg_expenses_final BEFORE UPDATE ON expenses
WHEN OLD.status <> 'draft' AND (
  NEW.gross IS NOT OLD.gross OR NEW.vat_amount IS NOT OLD.vat_amount OR NEW.vat_class IS NOT OLD.vat_class OR
  NEW.vat_recoverable IS NOT OLD.vat_recoverable OR NEW.category_id IS NOT OLD.category_id OR
  NEW.expense_date IS NOT OLD.expense_date OR NEW.period_start IS NOT OLD.period_start OR NEW.period_end IS NOT OLD.period_end OR
  NEW.description IS NOT OLD.description OR NEW.payee IS NOT OLD.payee OR NEW.invoice_ref IS NOT OLD.invoice_ref OR
  OLD.status IN ('cancelled','reversed') OR (OLD.status = 'posted' AND NEW.status <> 'reversed'))
BEGIN SELECT RAISE(ABORT, 'posted expense is immutable: use a reversal'); END;
CREATE TRIGGER trg_expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'expenses are never deleted: cancel or reverse'); END;

CREATE TABLE expense_payments (
  id          INTEGER PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  expense_id  INTEGER NOT NULL REFERENCES expenses(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),  -- negative = reversal of payment reversed_of
  method      TEXT NOT NULL CHECK (method IN ('bank','till')),
  paid_on     TEXT NOT NULL,
  reference   TEXT,
  shift_id    INTEGER REFERENCES register_shifts(id),
  reversed_of INTEGER UNIQUE REFERENCES expense_payments(id),
  reason      TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  CHECK ((amount < 0) = (reversed_of IS NOT NULL)),
  CHECK (method <> 'till' OR shift_id IS NOT NULL)
) STRICT;
CREATE INDEX ix_expense_payments_expense ON expense_payments(expense_id);
CREATE INDEX ix_expense_payments_shift ON expense_payments(shift_id);
${immutable('expense_payments')}

CREATE TABLE expense_amortization (
  id         INTEGER PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES expenses(id),
  month      TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (expense_id, month)
) STRICT;
${immutable('expense_amortization')}

INSERT INTO invoice_counters (series, next_value) VALUES ('EXP', 1);
`;
