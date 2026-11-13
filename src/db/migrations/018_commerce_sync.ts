// The queue for the online store's stock and catalogue sync. Separate from sync_outbox, which only carries the owner dashboard's snapshots.
// Triggers write here in the same transaction as the change, so a change cannot commit without its event and inventory rules stay untouched.
// While commerce_enabled is 0 the triggers do nothing.
const ON = `(SELECT value FROM settings WHERE key = 'commerce_enabled') = '1'`;

export const sql = `
CREATE TABLE commerce_outbox (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('stock.movement','stock.checkpoint','catalog.product','catalog.category')),
  row_id     INTEGER,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

INSERT INTO settings (key, value) VALUES ('commerce_enabled', '0'), ('commerce_last_ok_at', ''), ('commerce_last_error', '');

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
