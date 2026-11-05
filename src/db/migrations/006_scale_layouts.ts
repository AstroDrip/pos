// Configurable scale-label layouts (ADR-3) and the scanned label code kept on each sale line for audit.
// The old fixed-layout table scale_barcode_formats stays and keeps working.
// No layout is created here: the store's real layout must be read from a real label first.
export const sql = `
CREATE TABLE scale_label_layouts (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  fields_json  TEXT NOT NULL,
  item_matches TEXT NOT NULL DEFAULT 'plu' CHECK (item_matches IN ('plu','sku')),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

-- Adding a column does not change any existing row; the immutability triggers on sale_lines stay in force.
ALTER TABLE sale_lines ADD COLUMN scan_code TEXT;
`;
