// Online orders accepted on the website wait here until the counter hands them over as a normal POS sale.
// The queue to the website is rebuilt to carry the handover event. Its numbering continues, so the website sees no gap or repeat.
const ON = `(SELECT value FROM settings WHERE key = 'commerce_enabled') = '1'`;

export const sql = `
CREATE TABLE commerce_orders (
  order_id          TEXT PRIMARY KEY,
  public_ref        TEXT NOT NULL,
  fulfilment        TEXT NOT NULL CHECK (fulfilment IN ('delivery','pickup')),
  payment_method    TEXT NOT NULL,
  customer_name     TEXT NOT NULL,
  phone             TEXT NOT NULL,
  delivery_fee_incl INTEGER NOT NULL CHECK (delivery_fee_incl >= 0),
  lines_json        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','handed_over','cancelled')),
  cancel_reason     TEXT,
  sale_id           INTEGER REFERENCES sales(id),
  received_at       TEXT NOT NULL
) STRICT;

CREATE TABLE commerce_order_links (
  sale_id  INTEGER PRIMARY KEY REFERENCES sales(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(order_id)
) STRICT;

INSERT INTO settings (key, value) VALUES ('commerce_command_cursor', '0');

DROP TRIGGER trg_commerce_movement;
DROP TRIGGER trg_commerce_product_insert;
DROP TRIGGER trg_commerce_product_update;
DROP TRIGGER trg_commerce_barcode_insert;
DROP TRIGGER trg_commerce_barcode_delete;
DROP TRIGGER trg_commerce_category_insert;
DROP TRIGGER trg_commerce_category_update;

CREATE TABLE commerce_outbox_new (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('stock.movement','stock.checkpoint','catalog.product','catalog.category','order.handed_over')),
  row_id     INTEGER,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
INSERT INTO commerce_outbox_new (seq, type, row_id, payload, created_at) SELECT seq, type, row_id, payload, created_at FROM commerce_outbox;
DELETE FROM sqlite_sequence WHERE name = 'commerce_outbox_new';
INSERT INTO sqlite_sequence (name, seq) SELECT 'commerce_outbox_new', seq FROM sqlite_sequence WHERE name = 'commerce_outbox';
DROP TABLE commerce_outbox;
ALTER TABLE commerce_outbox_new RENAME TO commerce_outbox;

CREATE TRIGGER trg_commerce_movement AFTER INSERT ON stock_movements WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('stock.movement', NEW.id); END;

CREATE TRIGGER trg_commerce_product_insert AFTER INSERT ON products WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', NEW.id); END;

CREATE TRIGGER trg_commerce_product_update AFTER UPDATE ON products WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', NEW.id); END;

CREATE TRIGGER trg_commerce_barcode_insert AFTER INSERT ON product_barcodes WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', NEW.product_id); END;

CREATE TRIGGER trg_commerce_barcode_delete AFTER DELETE ON product_barcodes WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', OLD.product_id); END;

CREATE TRIGGER trg_commerce_category_insert AFTER INSERT ON categories WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.category', NEW.id); END;

CREATE TRIGGER trg_commerce_category_update AFTER UPDATE ON categories WHEN ${ON}
BEGIN INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.category', NEW.id); END;
`;
