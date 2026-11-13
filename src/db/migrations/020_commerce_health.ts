// How much the website holds for online orders, shown beside stock in the POS. Read-only here: it is never added to stock_balances.
// The day of the last full stock check sent, so one is sent each store day.
export const sql = `
CREATE TABLE commerce_reserved (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  reserved   INTEGER NOT NULL CHECK (reserved >= 0),
  as_of      TEXT NOT NULL
) STRICT;

INSERT INTO settings (key, value) VALUES ('commerce_last_checkpoint_day', '');
`;
