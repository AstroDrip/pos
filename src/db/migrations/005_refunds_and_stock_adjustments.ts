// Phase 2: refunds (credit notes) and stock adjustments (wastage, stock counts).
//  Owner refund policy (decision D1, 2026-11-05): 7-day window, original receipt required,
//  refunds paid in cash, supervisor approval for every refund. Window kept as a setting.
//  Credit notes here are LOCAL documents. The ZATCA credit note (XML, signature, QR, reporting)
//  comes with the ZATCA phase; each refund already stores the original invoice and a UUID for it.

const immutable = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END;`;

export const sql = `
CREATE TABLE refunds (
  id               INTEGER PRIMARY KEY,
  refund_no        TEXT NOT NULL UNIQUE,
  uuid             TEXT NOT NULL UNIQUE,
  request_key      TEXT NOT NULL UNIQUE,
  original_sale_id INTEGER NOT NULL REFERENCES sales(id),
  shift_id         INTEGER NOT NULL REFERENCES register_shifts(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  approved_by      INTEGER NOT NULL REFERENCES users(id),
  reason           TEXT NOT NULL CHECK (length(reason) > 0),
  tender           TEXT NOT NULL CHECK (tender IN ('cash')),
  total_incl       INTEGER NOT NULL CHECK (total_incl > 0),
  total_vat        INTEGER NOT NULL CHECK (total_vat >= 0),
  total_excl       INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  CHECK (total_excl + total_vat = total_incl)
) STRICT;
CREATE INDEX ix_refunds_sale ON refunds(original_sale_id);
CREATE INDEX ix_refunds_shift ON refunds(shift_id);
CREATE INDEX ix_refunds_created ON refunds(created_at);
${immutable('refunds')}

CREATE TABLE refund_lines (
  refund_id       INTEGER NOT NULL REFERENCES refunds(id),
  line_no         INTEGER NOT NULL,
  sale_line_no    INTEGER NOT NULL,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  unit_price_incl INTEGER NOT NULL CHECK (unit_price_incl >= 0),
  vat_rate_bp     INTEGER NOT NULL,
  line_incl       INTEGER NOT NULL CHECK (line_incl >= 0),
  line_vat        INTEGER NOT NULL CHECK (line_vat >= 0),
  line_excl       INTEGER NOT NULL,
  unit_cost       INTEGER NOT NULL CHECK (unit_cost >= 0),
  restock         INTEGER NOT NULL CHECK (restock IN (0,1)),
  PRIMARY KEY (refund_id, line_no),
  CHECK (line_excl + line_vat = line_incl)
) STRICT;
${immutable('refund_lines')}

CREATE TABLE stock_adjustments (
  id          INTEGER PRIMARY KEY,
  adj_no      TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('waste','count')),
  reason      TEXT NOT NULL CHECK (length(reason) > 0),
  total_value INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
) STRICT;
${immutable('stock_adjustments')}

CREATE TABLE stock_adjustment_lines (
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id),
  line_no       INTEGER NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  system_qty    INTEGER NOT NULL,
  counted_qty   INTEGER,
  qty           INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost     INTEGER NOT NULL CHECK (unit_cost >= 0),
  value         INTEGER NOT NULL,
  PRIMARY KEY (adjustment_id, line_no)
) STRICT;
${immutable('stock_adjustment_lines')}

INSERT INTO invoice_counters (series, next_value) VALUES ('REFUND', 1), ('ADJ', 1);
INSERT INTO settings (key, value) VALUES ('refund_max_days', '7');
`;
