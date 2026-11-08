import { MILLI_PER_UNIT, extendPrice } from '../core/money';
import { parseScaleBarcode, type ScaleBarcodeFormat } from '../core/scale-barcode';
import { LabelError, layoutToSpec, looksLike, parseLabel, parseLayoutSpec, validateLayout, type ParsedLabel, type ScaleLayout } from '../core/scale-layout';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { indexProduct, searchProducts as indexedSearch } from './search';
import { requirePermission } from './users';

export interface Product {
  id: number;
  sku: string;
  nameAr: string;
  nameEn: string;
  unitCode: string;
  sellMode: 'unit' | 'weight';
  vatRateBp: number;
  priceIncl: number;
  reorderLevel: number;
  active: boolean;
}

export interface ProductInput {
  sku: string;
  nameAr: string;
  nameEn: string;
  unitCode: string;
  sellMode: 'unit' | 'weight';
  vatRateBp: number;
  priceIncl: number;
  reorderLevel?: number;
  barcodes?: string[];
  plu?: string;
  aliases?: string[];
}

const SELECT_PRODUCT = `
  SELECT p.id, p.sku, p.name_ar AS nameAr, p.name_en AS nameEn, u.code AS unitCode, p.sell_mode AS sellMode,
         p.vat_rate_bp AS vatRateBp, p.price_incl AS priceIncl, p.reorder_level AS reorderLevel, p.active
  FROM products p JOIN units u ON u.id = p.unit_id`;

function toProduct(row: (Omit<Product, 'active'> & { active: number }) | undefined): Product | null {
  return row ? { ...row, active: row.active === 1 } : null;
}

export function getProduct(ctx: Ctx, id: number): Product | null {
  return toProduct(ctx.db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id) as never);
}

export function createProduct(ctx: Ctx, userId: number, input: ProductInput): number {
  requirePermission(ctx, userId, 'product.manage');
  if (!Number.isSafeInteger(input.priceIncl) || input.priceIncl < 0) throw new DomainError('VALIDATION', 'Invalid price');
  if (!Number.isSafeInteger(input.vatRateBp) || input.vatRateBp < 0 || input.vatRateBp > 10_000) throw new DomainError('VALIDATION', 'Invalid VAT rate');
  return ctx.db.transaction(() => {
    const unit = ctx.db.prepare('SELECT id, measure FROM units WHERE code = ?').get(input.unitCode) as { id: number; measure: string } | undefined;
    if (!unit) throw new DomainError('VALIDATION', `Unknown unit ${input.unitCode}`);
    if ((input.sellMode === 'weight') !== (unit.measure === 'weight')) {
      throw new DomainError('VALIDATION', 'Weighed products must use a weight unit');
    }
    const now = ctx.now();
    let id: number;
    try {
      id = Number(
        ctx.db
          .prepare(
            `INSERT INTO products (sku, name_ar, name_en, unit_id, sell_mode, vat_rate_bp, price_incl, reorder_level, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(input.sku.trim(), input.nameAr.trim(), input.nameEn.trim(), unit.id, input.sellMode, input.vatRateBp, input.priceIncl, input.reorderLevel ?? 0, now, now)
          .lastInsertRowid,
      );
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new DomainError('CONFLICT', `SKU ${input.sku} already exists`);
      throw e;
    }
    ctx.db.prepare('INSERT INTO price_history (product_id, old_price, new_price, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)').run(id, input.priceIncl, userId, now);
    for (const code of input.barcodes ?? []) addBarcodeTx(ctx, id, code);
    if (input.plu) addPluTx(ctx, id, input.plu);
    for (const a of cleanAliases(input.aliases)) ctx.db.prepare('INSERT INTO product_aliases (product_id, alias) VALUES (?, ?)').run(id, a);
    indexProduct(ctx, id);
    appendAudit(ctx, { userId, action: 'product.create', entity: 'product', entityId: id, details: { ...input } });
    return id;
  })();
}

function cleanAliases(list: string[] | undefined): string[] {
  const out = [...new Set((list ?? []).map((a) => a.trim()).filter(Boolean))];
  if (out.some((a) => a.length > 80) || out.length > 20) throw new DomainError('VALIDATION', 'Too many or too long other names');
  return out;
}

/** Replaces a product's approved other names (synonyms) used by search. */
export function setAliases(ctx: Ctx, userId: number, productId: number, aliases: string[]): void {
  requirePermission(ctx, userId, 'product.manage');
  const list = cleanAliases(aliases);
  ctx.db.transaction(() => {
    if (!getProduct(ctx, productId)) throw new DomainError('NOT_FOUND', 'Product not found');
    const old = (ctx.db.prepare('SELECT alias FROM product_aliases WHERE product_id = ? ORDER BY alias').all(productId) as { alias: string }[]).map((r) => r.alias);
    ctx.db.prepare('DELETE FROM product_aliases WHERE product_id = ?').run(productId);
    for (const a of list) ctx.db.prepare('INSERT INTO product_aliases (product_id, alias) VALUES (?, ?)').run(productId, a);
    indexProduct(ctx, productId);
    appendAudit(ctx, { userId, action: 'product.aliases', entity: 'product', entityId: productId, details: { old, new: list } });
  })();
}

export function getAliases(ctx: Ctx, productId: number): string[] {
  return (ctx.db.prepare('SELECT alias FROM product_aliases WHERE product_id = ? ORDER BY alias').all(productId) as { alias: string }[]).map((r) => r.alias);
}

/**
 * Deactivates or reactivates a product. Products are never deleted: past sales keep referring to them.
 * An inactive product cannot be sold or found in search; scanning it says so (audit scenario 3.2).
 */
export function setProductActive(ctx: Ctx, userId: number, productId: number, active: boolean, reason: string): void {
  requirePermission(ctx, userId, 'product.manage');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  ctx.db.transaction(() => {
    const p = getProduct(ctx, productId);
    if (!p) throw new DomainError('NOT_FOUND', 'Product not found');
    if (p.active === active) return;
    ctx.db.prepare('UPDATE products SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, ctx.now(), productId);
    indexProduct(ctx, productId);
    appendAudit(ctx, { userId, action: active ? 'product.activate' : 'product.deactivate', entity: 'product', entityId: productId, details: { reason: reason.trim() } });
  })();
}

export function setPrice(ctx: Ctx, userId: number, productId: number, priceIncl: number): void {
  requirePermission(ctx, userId, 'product.manage');
  if (!Number.isSafeInteger(priceIncl) || priceIncl < 0) throw new DomainError('VALIDATION', 'Invalid price');
  ctx.db.transaction(() => {
    const p = getProduct(ctx, productId);
    if (!p) throw new DomainError('NOT_FOUND', 'Product not found');
    const now = ctx.now();
    ctx.db.prepare('UPDATE products SET price_incl = ?, updated_at = ? WHERE id = ?').run(priceIncl, now, productId);
    ctx.db.prepare('INSERT INTO price_history (product_id, old_price, new_price, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)').run(productId, p.priceIncl, priceIncl, userId, now);
    appendAudit(ctx, { userId, action: 'product.price', entity: 'product', entityId: productId, details: { old: p.priceIncl, new: priceIncl } });
  })();
}

function addBarcodeTx(ctx: Ctx, productId: number, barcode: string, qtyPerScan = MILLI_PER_UNIT): void {
  if (!/^[0-9A-Za-z-]{3,32}$/.test(barcode)) throw new DomainError('VALIDATION', `Invalid barcode ${barcode}`);
  const existing = ctx.db.prepare('SELECT product_id FROM product_barcodes WHERE barcode = ?').get(barcode) as { product_id: number } | undefined;
  if (existing) throw new DomainError('CONFLICT', `Barcode ${barcode} already belongs to product ${existing.product_id}`);
  ctx.db.prepare('INSERT INTO product_barcodes (barcode, product_id, qty_per_scan) VALUES (?, ?, ?)').run(barcode, productId, qtyPerScan);
}

function addPluTx(ctx: Ctx, productId: number, plu: string): void {
  if (!/^\d{1,6}$/.test(plu)) throw new DomainError('VALIDATION', 'PLU must be 1–6 digits');
  const existing = ctx.db.prepare('SELECT product_id FROM plu_codes WHERE plu = ?').get(plu) as { product_id: number } | undefined;
  if (existing) throw new DomainError('CONFLICT', `PLU ${plu} already belongs to product ${existing.product_id}`);
  ctx.db.prepare('INSERT INTO plu_codes (plu, product_id) VALUES (?, ?)').run(plu, productId);
}

export function scaleFormats(ctx: Ctx): ScaleBarcodeFormat[] {
  return ctx.db
    .prepare("SELECT prefix, item_digits AS itemDigits, value_digits AS valueDigits, embedded FROM scale_barcode_formats")
    .all() as ScaleBarcodeFormat[];
}

export interface ItemInfo {
  productId: number;
  sku: string;
  nameAr: string;
  nameEn: string;
  priceIncl: number;
  vatRateBp: number;
  sellMode: 'unit' | 'weight';
  stockQty: number;
}

/** Price and stock for the till's item check. Never includes the cost. */
export function itemInfo(ctx: Ctx, productId: number): ItemInfo {
  const r = ctx.db
    .prepare(
      `SELECT p.id AS productId, p.sku, p.name_ar AS nameAr, p.name_en AS nameEn, p.price_incl AS priceIncl, p.vat_rate_bp AS vatRateBp,
              p.sell_mode AS sellMode, COALESCE(b.qty, 0) AS stockQty
       FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id WHERE p.id = ?`,
    )
    .get(productId) as ItemInfo | undefined;
  if (!r) throw new DomainError('NOT_FOUND', 'Product not found');
  return r;
}

export interface LookupResult {
  product: Product;
  qty: number; // milli-units to add
  source: 'barcode' | 'plu' | 'scale' | 'sku';
  /** The exact scale label scanned, kept on the sale line for audit. */
  scanCode?: string;
}

/**
 * Resolves scanned or typed input: product barcode → PLU → scale label barcode → SKU.
 * Scale item codes are matched against PLUs (leading zeros ignored).
 * An inactive product is reported as such, never silently replaced by another (audit 3.2).
 */
export function lookup(ctx: Ctx, code: string): LookupResult | null {
  const c = code.trim();
  if (!c) return null;

  const bc = ctx.db.prepare('SELECT product_id, qty_per_scan FROM product_barcodes WHERE barcode = ?').get(c) as { product_id: number; qty_per_scan: number } | undefined;
  if (bc) return mustBeActive(getProduct(ctx, bc.product_id), bc.qty_per_scan, 'barcode');

  const plu = ctx.db.prepare('SELECT product_id FROM plu_codes WHERE plu = ?').get(c) as { product_id: number } | undefined;
  if (plu) {
    const p = getProduct(ctx, plu.product_id);
    // A typed PLU for a weighed item needs a weight from a scale label; qty 0 tells the UI to ask for the label.
    return mustBeActive(p, p?.sellMode === 'weight' ? 0 : MILLI_PER_UNIT, 'plu');
  }

  const formats = scaleFormats(ctx);
  if (/^\d{13}$/.test(c) && formats.some((f) => c.startsWith(f.prefix))) {
    // Looks like a scale label: from here on it is either a valid label or a clear error, never a guess.
    const scale = parseScaleBarcode(c, formats);
    if (!scale) throw new DomainError('VALIDATION', 'Scale label barcode is damaged (check digit wrong). Re-scan or reprint the label.');
    const row = ctx.db.prepare('SELECT product_id FROM plu_codes WHERE CAST(plu AS INTEGER) = ?').get(Number(scale.itemCode)) as { product_id: number } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', `Scale label product code ${scale.itemCode} is not set up as a PLU`);
    const p = getProduct(ctx, row.product_id)!;
    return { product: p, qty: labelQty(ctx, p, scale), source: 'scale', scanCode: c };
  }

  // Configurable layouts (ADR-3): any field order, e.g. item code + quantity + PLU.
  const layout = scaleLayouts(ctx, true).find((l) => looksLike(c, l));
  if (layout) {
    let label: ParsedLabel;
    try {
      label = parseLabel(c, layout);
    } catch (e) {
      throw new DomainError('VALIDATION', e instanceof LabelError ? e.message : 'Scale label could not be read');
    }
    const p = labelProduct(ctx, label, layout);
    return { product: p, qty: labelQty(ctx, p, label), source: 'scale', scanCode: c };
  }

  const sku = ctx.db.prepare('SELECT id FROM products WHERE sku = ?').get(c) as { id: number } | undefined;
  if (sku) return mustBeActive(getProduct(ctx, sku.id), MILLI_PER_UNIT, 'sku');
  return null;
}

/** Finds the product a label names. With both an item code and a PLU, both must name the same product. */
function labelProduct(ctx: Ctx, label: ParsedLabel, layout: ScaleLayout): Product {
  const byPlu = (code: string) => (ctx.db.prepare('SELECT product_id FROM plu_codes WHERE CAST(plu AS INTEGER) = ?').get(Number(code)) as { product_id: number } | undefined)?.product_id;
  const bySku = (code: string) => (ctx.db.prepare('SELECT id FROM products WHERE sku = ?').get(code) as { id: number } | undefined)?.id;
  let fromPlu: number | undefined;
  let fromItem: number | undefined;
  if (label.plu !== undefined) {
    fromPlu = byPlu(label.plu);
    if (fromPlu === undefined) throw new DomainError('NOT_FOUND', `Scale label PLU ${label.plu} is not set up`);
  }
  if (label.itemCode !== undefined) {
    fromItem = layout.itemMatches === 'sku' ? bySku(label.itemCode) : byPlu(label.itemCode);
    if (fromItem === undefined) throw new DomainError('NOT_FOUND', `Scale label item code ${label.itemCode} is not set up`);
  }
  if (fromPlu !== undefined && fromItem !== undefined && fromPlu !== fromItem) {
    throw new DomainError('VALIDATION', 'Scale label item code and PLU point to different products. Check the scale setup.');
  }
  return getProduct(ctx, (fromPlu ?? fromItem)!)!;
}

/** Quantity (milli-units) from a scale label, with every safety check. Shared by both label paths. */
function labelQty(ctx: Ctx, p: Product, label: { weightGrams?: number; priceHalalas?: number; pieces?: number }): number {
  if (!p.active) throw new DomainError('VALIDATION', `${p.nameEn} is inactive and cannot be sold`);
  const limits = scaleLimits(ctx);
  if (label.pieces !== undefined) {
    if (p.sellMode !== 'unit') throw new DomainError('VALIDATION', `${p.nameEn} is sold by weight; a piece-count label does not fit it`);
    if (label.pieces <= 0) throw new DomainError('VALIDATION', 'Scale label shows zero pieces. Check the label.');
    if (label.pieces > 999) throw new DomainError('VALIDATION', 'Scale label piece count is impossible. Check the label.');
    return label.pieces * MILLI_PER_UNIT;
  }
  if (p.sellMode !== 'weight') throw new DomainError('VALIDATION', `${p.nameEn} is not a weighed product; its PLU should not be on a scale label`);
  if (label.weightGrams !== undefined) {
    if (label.weightGrams <= 0) throw new DomainError('VALIDATION', 'Scale label shows zero weight. Reweigh the item.');
    if (label.weightGrams > limits.maxGrams) throw new DomainError('VALIDATION', `Scale label weight ${label.weightGrams} g is above the allowed ${limits.maxGrams} g. Check the label.`);
    return label.weightGrams;
  }
  const price = label.priceHalalas!;
  if (price <= 0) throw new DomainError('VALIDATION', 'Scale label shows zero price. Reweigh the item.');
  if (price > limits.maxHalalas) throw new DomainError('VALIDATION', 'Scale label price is above the allowed maximum. Check the label.');
  // Price labels: the printed price is authoritative. The POS only accepts the label if some exact weight at
  // today's shelf price gives that price; otherwise the label is out of date and must be reprinted.
  const qty = qtyForLabelPrice(p.priceIncl, price);
  if (qty === null) throw new DomainError('VALIDATION', 'Label price does not match the current shelf price. Reweigh the item.');
  // The weight implied by the price must be possible too (e.g. 999.99 SAR of bananas = 167 kg).
  if (qty > limits.maxGrams) throw new DomainError('VALIDATION', `Scale label price implies ${qty} g, above the allowed ${limits.maxGrams} g. Check the label.`);
  return qty;
}

export interface ScaleLayoutRow extends ScaleLayout {
  id: number;
  spec: string;
  active: boolean;
}

export function scaleLayouts(ctx: Ctx, activeOnly = false): ScaleLayoutRow[] {
  const rows = ctx.db
    .prepare(`SELECT id, name, fields_json, item_matches, active FROM scale_label_layouts ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY id`)
    .all() as { id: number; name: string; fields_json: string; item_matches: 'plu' | 'sku'; active: number }[];
  return rows.map((r) => {
    const fields = JSON.parse(r.fields_json) as ScaleLayout['fields'];
    return { id: r.id, name: r.name, fields, itemMatches: r.item_matches, active: r.active === 1, spec: layoutToSpec(fields) };
  });
}

/** Creates or updates a label layout from its text spec. Needs settings.manage; audited. */
export function saveScaleLayout(ctx: Ctx, userId: number, input: { id?: number; name: string; spec: string; itemMatches: 'plu' | 'sku'; active: boolean }): number {
  requirePermission(ctx, userId, 'settings.manage');
  let layout: ScaleLayout;
  try {
    layout = { name: input.name.trim(), fields: parseLayoutSpec(input.spec), itemMatches: input.itemMatches };
    validateLayout(layout);
  } catch (e) {
    throw new DomainError('VALIDATION', (e as Error).message);
  }
  return ctx.db.transaction(() => {
    const now = ctx.now();
    const json = JSON.stringify(layout.fields);
    let id: number;
    if (input.id) {
      const r = ctx.db.prepare('UPDATE scale_label_layouts SET name = ?, fields_json = ?, item_matches = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(layout.name, json, layout.itemMatches, input.active ? 1 : 0, now, input.id);
      if (r.changes === 0) throw new DomainError('NOT_FOUND', 'Layout not found');
      id = input.id;
    } else {
      id = Number(ctx.db.prepare('INSERT INTO scale_label_layouts (name, fields_json, item_matches, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(layout.name, json, layout.itemMatches, input.active ? 1 : 0, now, now).lastInsertRowid);
    }
    appendAudit(ctx, { userId, action: 'scale.layout_saved', entity: 'scale_label_layout', entityId: id, details: { name: layout.name, spec: layoutToSpec(layout.fields), itemMatches: layout.itemMatches, active: input.active } });
    return id;
  })();
}

function mustBeActive(p: Product | null, qty: number, source: LookupResult['source']): LookupResult | null {
  if (!p) return null;
  if (!p.active) throw new DomainError('VALIDATION', `${p.nameEn} is inactive and cannot be sold`);
  return { product: p, qty, source };
}

export function scaleLimits(ctx: Ctx): { maxGrams: number; maxHalalas: number } {
  const get = (k: string, d: number) => Number((ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? d);
  return { maxGrams: get('scale_label_max_grams', 30_000), maxHalalas: get('scale_label_max_halalas', 100_000) };
}

/** Weight (grams) whose price equals the printed label price exactly, or null if none does. */
export function qtyForLabelPrice(unitPrice: number, labelPrice: number): number | null {
  if (unitPrice <= 0 || labelPrice <= 0) return null;
  const guess = Math.floor((labelPrice * MILLI_PER_UNIT) / unitPrice);
  for (const q of [guess, guess + 1, guess - 1, guess + 2]) {
    if (q > 0 && extendPrice(unitPrice, q) === labelPrice) return q;
  }
  return null;
}

/** Product list for back-office screens: indexed search when text is given, otherwise the first products by name. */
export function searchProducts(ctx: Ctx, text: string, limit = 20): Product[] {
  if (!text.trim()) {
    return (ctx.db.prepare(`${SELECT_PRODUCT} WHERE p.active = 1 ORDER BY p.name_en LIMIT ?`).all(limit) as never[]).map((r) => toProduct(r)!);
  }
  return indexedSearch(ctx, text, limit).map((h) => h.product);
}
