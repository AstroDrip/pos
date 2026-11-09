// Final tax invoices for proformas, and the review that decides whether their VAT can be claimed.
// New tables only: the proforma, its purchase invoice and their journal entries are never changed.
// A claim is its own adjusting entry (Dr 2210 / Cr 5010). PROVISIONAL until the accountant approves.

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
INSERT INTO permissions (code, description) VALUES
  ('vat.review',  'Record and verify final supplier tax invoices'),
  ('vat.approve', 'Record the accountant decision and claim supplier VAT');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin' AND p.code IN ('vat.review', 'vat.approve');

CREATE TABLE supplier_vat_reviews (
  id              INTEGER PRIMARY KEY,
  bill_id         INTEGER NOT NULL UNIQUE REFERENCES supplier_bills(id),
  invoice_id      INTEGER NOT NULL UNIQUE REFERENCES purchase_invoices(id),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  doc_status      TEXT NOT NULL CHECK (doc_status IN ('final_received','details_verified')),
  vat_status      TEXT NOT NULL CHECK (vat_status IN ('pending','accountant_pending','approved','rejected','claimed','not_claimed')),
  final_no        TEXT NOT NULL CHECK (length(final_no) > 0),
  final_date      TEXT NOT NULL,
  final_net       INTEGER NOT NULL CHECK (final_net >= 0),
  final_vat       INTEGER NOT NULL CHECK (final_vat >= 0),
  final_total     INTEGER NOT NULL,
  final_vat_no    TEXT,
  verify_note     TEXT,
  accountant_name TEXT,
  decision_ref    TEXT,
  decision_note   TEXT,
  approved_vat    INTEGER CHECK (approved_vat IS NULL OR approved_vat > 0),
  updated_at      TEXT NOT NULL,
  CHECK (final_total = final_net + final_vat),
  UNIQUE (supplier_id, final_no)
) STRICT;
CREATE INDEX ix_vat_reviews_status ON supplier_vat_reviews(vat_status);

CREATE TABLE supplier_vat_events (
  id         INTEGER PRIMARY KEY,
  review_id  INTEGER NOT NULL REFERENCES supplier_vat_reviews(id),
  action     TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  at         TEXT NOT NULL,
  details    TEXT NOT NULL
) STRICT;
CREATE INDEX ix_vat_events_review ON supplier_vat_events(review_id);
${immutable('supplier_vat_events')}

CREATE TABLE supplier_vat_attachments (
  id         INTEGER PRIMARY KEY,
  review_id  INTEGER NOT NULL REFERENCES supplier_vat_reviews(id),
  sha256     TEXT NOT NULL UNIQUE,
  file_name  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 5000000),
  data       BLOB NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  at         TEXT NOT NULL
) STRICT;
CREATE INDEX ix_vat_attachments_review ON supplier_vat_attachments(review_id);
${immutable('supplier_vat_attachments')}

CREATE TABLE supplier_vat_claims (
  id          INTEGER PRIMARY KEY,
  review_id   INTEGER NOT NULL REFERENCES supplier_vat_reviews(id),
  request_key TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('claim','reverse')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  claim_date  TEXT NOT NULL,
  reason      TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX ix_vat_claims_review ON supplier_vat_claims(review_id);
CREATE INDEX ix_vat_claims_date ON supplier_vat_claims(claim_date);
${immutable('supplier_vat_claims')}
`;
