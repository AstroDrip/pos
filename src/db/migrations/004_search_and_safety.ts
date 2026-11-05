// Indexed product search (audit Part 2) and safety fixes found in the retail audit.
//  - name_en_norm / name_ar_norm: normalised names with B-tree indexes for fast "starts with" search
//  - product_fts: FTS5 index of normalised names, aliases and category for token-prefix search
//  - product_aliases: approved alternative names / synonyms
//  The normalised columns and FTS rows are filled by the app (services/search.ts), because the Arabic
//  normalisation lives in TypeScript; rebuildSearchIndex() runs at startup when they are out of date.
//  - goods_receipts.request_key: stops a double-clicked "Save receipt" from receiving stock twice (BUG-007)
//  - scale label limits: reject impossible weights/prices (BUG-004). Defaults need owner approval.
export const sql = `
ALTER TABLE products ADD COLUMN name_en_norm TEXT;
ALTER TABLE products ADD COLUMN name_ar_norm TEXT;
CREATE INDEX ix_products_name_en_norm ON products(name_en_norm) WHERE active = 1;
CREATE INDEX ix_products_name_ar_norm ON products(name_ar_norm) WHERE active = 1;

CREATE TABLE product_aliases (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  alias      TEXT NOT NULL CHECK (length(alias) > 0),
  UNIQUE (product_id, alias)
) STRICT;

CREATE VIRTUAL TABLE product_fts USING fts5(
  names, aliases, category,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

ALTER TABLE goods_receipts ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX ux_goods_receipts_request_key ON goods_receipts(request_key) WHERE request_key IS NOT NULL;

INSERT INTO settings (key, value) VALUES
  ('scale_label_max_grams', '30000'),
  ('scale_label_max_halalas', '100000'),
  ('search_index_version', '0');
`;
