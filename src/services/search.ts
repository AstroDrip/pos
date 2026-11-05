import { normalizeForSearch, tokens } from '../core/search-normalize';
import type { Product } from './catalog';
import type { Ctx } from './context';

// Indexed product search (audit Part 2). Every query below uses an index; see SEARCH_PERFORMANCE_REPORT.md
// for the EXPLAIN QUERY PLAN output. Ranking (lower is better):
//   1 exact barcode · 2 exact SKU or PLU · 3 exact name · 4 name starts with the text
//   5 every word starts a word in the name · 6 alias/category match · 7 SKU starts with the text

export const SEARCH_INDEX_VERSION = '1';

export interface SearchHit {
  product: Product;
  rank: number;
  matchedBy: 'barcode' | 'sku' | 'plu' | 'name' | 'name_prefix' | 'word_prefix' | 'alias' | 'sku_prefix';
}

const PRODUCT_COLUMNS = `p.id, p.sku, p.name_ar AS nameAr, p.name_en AS nameEn, u.code AS unitCode, p.sell_mode AS sellMode,
  p.vat_rate_bp AS vatRateBp, p.price_incl AS priceIncl, p.reorder_level AS reorderLevel, p.active`;

type Row = Omit<Product, 'active'> & { active: number; name_en_norm?: string; name_ar_norm?: string };
const toProduct = (r: Row): Product => ({
  id: r.id, sku: r.sku, nameAr: r.nameAr, nameEn: r.nameEn, unitCode: r.unitCode, sellMode: r.sellMode,
  vatRateBp: r.vatRateBp, priceIncl: r.priceIncl, reorderLevel: r.reorderLevel, active: r.active === 1,
});

/** Writes the normalised names and the FTS row for one product. Call inside the product's write transaction. */
export function indexProduct(ctx: Ctx, productId: number): void {
  const p = ctx.db
    .prepare('SELECT p.name_en, p.name_ar, p.active, c.name_en AS cat_en, c.name_ar AS cat_ar FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
    .get(productId) as { name_en: string; name_ar: string; active: number; cat_en: string | null; cat_ar: string | null } | undefined;
  ctx.db.prepare('DELETE FROM product_fts WHERE rowid = ?').run(productId);
  if (!p) return;
  const en = normalizeForSearch(p.name_en);
  const ar = normalizeForSearch(p.name_ar);
  ctx.db.prepare('UPDATE products SET name_en_norm = ?, name_ar_norm = ? WHERE id = ?').run(en, ar, productId);
  if (!p.active) return; // inactive products are not offered in search
  const aliases = (ctx.db.prepare('SELECT alias FROM product_aliases WHERE product_id = ?').all(productId) as { alias: string }[])
    .map((a) => normalizeForSearch(a.alias))
    .join(' ');
  ctx.db
    .prepare('INSERT INTO product_fts (rowid, names, aliases, category) VALUES (?, ?, ?, ?)')
    .run(productId, `${en} ${ar}`, aliases, normalizeForSearch(`${p.cat_en ?? ''} ${p.cat_ar ?? ''}`));
}

/** Rebuilds the whole search index. Runs at startup when the index is missing or from an older version. */
export function rebuildSearchIndex(ctx: Ctx): number {
  return ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM product_fts').run();
    const ids = (ctx.db.prepare('SELECT id FROM products').all() as { id: number }[]).map((r) => r.id);
    for (const id of ids) indexProduct(ctx, id);
    ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'search_index_version'").run(SEARCH_INDEX_VERSION);
    return ids.length;
  })();
}

export function ensureSearchIndex(ctx: Ctx): void {
  const v = (ctx.db.prepare("SELECT value FROM settings WHERE key = 'search_index_version'").get() as { value: string } | undefined)?.value;
  const missing = (ctx.db.prepare('SELECT count(*) AS n FROM products WHERE name_en_norm IS NULL').get() as { n: number }).n;
  if (v !== SEARCH_INDEX_VERSION || missing > 0) rebuildSearchIndex(ctx);
}

/** Upper bound for an index range scan that means "starts with prefix". */
const upper = (prefix: string) => prefix + '\u{10FFFF}';

/** FTS5 query: every word must match the start of a word. Words are quoted, so user text cannot inject FTS syntax. */
function ftsQuery(words: string[]): string {
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' AND ');
}

export function searchProducts(ctx: Ctx, text: string, limit = 20): SearchHit[] {
  const raw = text.trim();
  if (!raw) return [];
  const norm = normalizeForSearch(raw);
  const hits = new Map<number, SearchHit>();
  const add = (rows: Row[], rank: number, matchedBy: SearchHit['matchedBy']) => {
    for (const r of rows) {
      const prev = hits.get(r.id);
      if (!prev || prev.rank > rank) hits.set(r.id, { product: toProduct(r), rank, matchedBy });
    }
  };
  const from = `FROM products p JOIN units u ON u.id = p.unit_id`;

  // 1–2: exact codes (primary-key / unique-index lookups)
  add(ctx.db.prepare(`SELECT ${PRODUCT_COLUMNS} ${from} JOIN product_barcodes b ON b.product_id = p.id WHERE b.barcode = ? AND p.active = 1`).all(raw) as Row[], 1, 'barcode');
  add(ctx.db.prepare(`SELECT ${PRODUCT_COLUMNS} ${from} WHERE p.sku = ? AND p.active = 1`).all(raw) as Row[], 2, 'sku');
  add(ctx.db.prepare(`SELECT ${PRODUCT_COLUMNS} ${from} JOIN plu_codes c ON c.product_id = p.id WHERE c.plu = ? AND p.active = 1`).all(raw) as Row[], 2, 'plu');

  if (norm) {
    // 3–4: exact name / name starts with the text (range scans on the partial B-tree indexes)
    for (const col of ['name_en_norm', 'name_ar_norm']) {
      const rows = ctx.db
        .prepare(`SELECT ${PRODUCT_COLUMNS}, p.${col} ${from} WHERE p.active = 1 AND p.${col} >= ? AND p.${col} < ? ORDER BY p.${col} LIMIT ?`)
        .all(norm, upper(norm), limit) as Row[];
      add(rows.filter((r) => r[col as 'name_en_norm'] === norm), 3, 'name');
      add(rows.filter((r) => r[col as 'name_en_norm'] !== norm), 4, 'name_prefix');
    }
    // 5–6: word-prefix matches through FTS5 (prefix indexes for 2 and 3 characters)
    const words = tokens(raw);
    if (words.length) {
      const q = ftsQuery(words);
      const inNames = ctx.db
        .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_fts f JOIN products p ON p.id = f.rowid JOIN units u ON u.id = p.unit_id WHERE product_fts MATCH ? ORDER BY rank LIMIT ?`)
        .all(`names : (${q})`, limit * 2) as Row[];
      add(inNames, 5, 'word_prefix');
      const elsewhere = ctx.db
        .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_fts f JOIN products p ON p.id = f.rowid JOIN units u ON u.id = p.unit_id WHERE product_fts MATCH ? ORDER BY rank LIMIT ?`)
        .all(`{aliases category} : (${q})`, limit) as Row[];
      add(elsewhere, 6, 'alias');
    }
  }
  // 7: SKU starts with the text (unique index range scan)
  add(ctx.db.prepare(`SELECT ${PRODUCT_COLUMNS} ${from} WHERE p.sku >= ? AND p.sku < ? AND p.active = 1 LIMIT ?`).all(raw, upper(raw), limit) as Row[], 7, 'sku_prefix');

  return [...hits.values()]
    .sort((a, b) => a.rank - b.rank || a.product.nameEn.length - b.product.nameEn.length || a.product.nameEn.localeCompare(b.product.nameEn))
    .slice(0, limit);
}
