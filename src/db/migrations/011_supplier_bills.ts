// Supplier bills: the detail of each paper, line by line. New tables and columns only.
// Stock, cost and journal entries still come from the existing goods receipt and supplier invoice code.

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
ALTER TABLE suppliers ADD COLUMN cr_number TEXT;
ALTER TABLE suppliers ADD COLUMN our_customer_no TEXT;
ALTER TABLE suppliers ADD COLUMN salesman TEXT;

CREATE TABLE supplier_items (
  id             INTEGER PRIMARY KEY,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  product_id     INTEGER NOT NULL REFERENCES products(id),
  supplier_code  TEXT,
  pack_name      TEXT NOT NULL DEFAULT 'PCS',
  units_per_pack INTEGER NOT NULL CHECK (units_per_pack > 0),
  last_price     INTEGER NOT NULL CHECK (last_price >= 0),
  updated_at     TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX ux_supplier_items_code ON supplier_items(supplier_id, supplier_code) WHERE supplier_code IS NOT NULL;
CREATE UNIQUE INDEX ux_supplier_items_pack ON supplier_items(supplier_id, product_id, pack_name);

CREATE TABLE supplier_bills (
  id             INTEGER PRIMARY KEY,
  request_key    TEXT NOT NULL UNIQUE,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('tax_invoice','delivery_note','proforma','other')),
  doc_no         TEXT NOT NULL,
  doc_date       TEXT NOT NULL,
  delivery_date  TEXT,
  sales_agent    TEXT,
  pay_type       TEXT NOT NULL CHECK (pay_type IN ('paid','credit')),
  grn_id         INTEGER NOT NULL REFERENCES goods_receipts(id),
  bill_discount  INTEGER NOT NULL CHECK (bill_discount >= 0),
  bill_charge    INTEGER NOT NULL CHECK (bill_charge >= 0),
  paper_gross    INTEGER,
  paper_discount INTEGER,
  paper_net      INTEGER NOT NULL,
  paper_vat      INTEGER NOT NULL,
  paper_total    INTEGER NOT NULL,
  pages          INTEGER NOT NULL CHECK (pages > 0),
  notes          TEXT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  UNIQUE (supplier_id, doc_type, doc_no)
) STRICT;
CREATE INDEX ix_supplier_bills_date ON supplier_bills(doc_date);
${immutable('supplier_bills')}

CREATE TABLE supplier_bill_lines (
  bill_id        INTEGER NOT NULL REFERENCES supplier_bills(id),
  line_no        INTEGER NOT NULL,
  page_no        INTEGER NOT NULL,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  supplier_code  TEXT,
  bill_text      TEXT,
  tariff_code    TEXT,
  pack_name      TEXT NOT NULL,
  units_per_pack INTEGER NOT NULL,
  packs          INTEGER NOT NULL,
  loose_qty      INTEGER NOT NULL,
  free_qty       INTEGER NOT NULL,
  received_qty   INTEGER NOT NULL,
  price_basis    TEXT NOT NULL CHECK (price_basis IN ('pack','unit')),
  price          INTEGER NOT NULL,
  gross          INTEGER NOT NULL,
  discount       INTEGER NOT NULL,
  discount_bp    INTEGER,
  net            INTEGER NOT NULL,
  vat_rate_bp    INTEGER NOT NULL,
  vat            INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  grn_line_from  INTEGER NOT NULL,
  grn_line_count INTEGER NOT NULL,
  PRIMARY KEY (bill_id, line_no)
) STRICT;
CREATE INDEX ix_supplier_bill_lines_product ON supplier_bill_lines(product_id);
${immutable('supplier_bill_lines')}
`;
