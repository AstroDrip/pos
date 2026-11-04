import { MILLI_PER_UNIT, extendPrice } from '../core/money';
import { parseScaleBarcode, type ScaleBarcodeFormat } from '../core/scale-barcode';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
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
    appendAudit(ctx, { userId, action: 'product.create', entity: 'product', entityId: id, details: { ...input } });
    return id;
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

export interface LookupResult {
  product: Product;
  qty: number; // milli-units to add
  source: 'barcode' | 'plu' | 'scale' | 'sku';
}

/**
 * Resolves scanned or typed input: product barcode → PLU → scale label barcode → SKU.
 * Scale item codes are matched against PLUs (leading zeros ignored).
 */
export function lookup(ctx: Ctx, code: string): LookupResult | null {
  const c = code.trim();
  if (!c) return null;

  const bc = ctx.db.prepare('SELECT product_id, qty_per_scan FROM product_barcodes WHERE barcode = ?').get(c) as { product_id: number; qty_per_scan: number } | undefined;
  if (bc) return active(getProduct(ctx, bc.product_id), bc.qty_per_scan, 'barcode');

  const plu = ctx.db.prepare('SELECT product_id FROM plu_codes WHERE plu = ?').get(c) as { product_id: number } | undefined;
  if (plu) {
    const p = getProduct(ctx, plu.product_id);
    // A typed PLU for a weighed item needs a weight from the scale; qty 0 tells the UI to ask.
    return active(p, p?.sellMode === 'weight' ? 0 : MILLI_PER_UNIT, 'plu');
  }

  const scale = parseScaleBarcode(c, scaleFormats(ctx));
  if (scale) {
    const row = ctx.db.prepare('SELECT product_id FROM plu_codes WHERE CAST(plu AS INTEGER) = ?').get(Number(scale.itemCode)) as { product_id: number } | undefined;
    const p = row ? getProduct(ctx, row.product_id) : null;
    if (!p || !p.active) return null;
    if (scale.weightGrams !== undefined) return { product: p, qty: scale.weightGrams, source: 'scale' };
    const qty = qtyForLabelPrice(p.priceIncl, scale.priceHalalas!);
    if (qty === null) throw new DomainError('VALIDATION', 'Label price does not match the current shelf price. Reweigh the item.');
    return { product: p, qty, source: 'scale' };
  }

  const sku = ctx.db.prepare('SELECT id FROM products WHERE sku = ?').get(c) as { id: number } | undefined;
  if (sku) return active(getProduct(ctx, sku.id), MILLI_PER_UNIT, 'sku');
  return null;
}

function active(p: Product | null, qty: number, source: LookupResult['source']): LookupResult | null {
  return p && p.active ? { product: p, qty, source } : null;
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

export function searchProducts(ctx: Ctx, text: string, limit = 20): Product[] {
  const like = `%${text.trim().replace(/[%_]/g, '')}%`;
  return (
    ctx.db.prepare(`${SELECT_PRODUCT} WHERE p.active = 1 AND (p.name_en LIKE ? OR p.name_ar LIKE ? OR p.sku LIKE ?) ORDER BY p.name_en LIMIT ?`).all(like, like, like, limit) as never[]
  ).map((r) => toProduct(r)!);
}
