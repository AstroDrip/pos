// A bill or supplier bill left open when the app stopped. Not a sale or a purchase: no invoice, stock or ledger effect.
export const sql = `
CREATE TABLE bill_drafts (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL CHECK (kind IN ('sale','supplier_bill')),
  payload_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
) STRICT;
`;
