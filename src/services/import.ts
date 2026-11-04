import { csvRecords } from '../core/csv';
import { parseSar } from '../core/money';
import { isValidEan13 } from '../core/scale-barcode';
import { appendAudit } from './audit';
import { createProduct, type ProductInput } from './catalog';
import { DomainError, type Ctx } from './context';
import { createSupplier } from './parties';
import { requirePermission } from './users';

// Migration plan §K: dry run → exception report → sign-off → import all-or-nothing.
// Opening stock and opening balances are NOT imported here; they need the accountant's approval.

export const PRODUCT_COLUMNS = ['sku', 'name_ar', 'name_en', 'sold_by', 'price_incl', 'vat_percent', 'barcode', 'plu'] as const;
export const SUPPLIER_COLUMNS = ['name', 'phone', 'vat_number', 'payment_terms_days'] as const;

export interface ImportIssue {
  row: number; // 1-based data row (header is row 0)
  field: string;
  message: string;
}

export interface DryRun<T> {
  rows: number;
  valid: T[];
  issues: ImportIssue[]; // block the import
  warnings: ImportIssue[]; // the owner must confirm, but the row is still imported
}

export function dryRunProducts(ctx: Ctx, csv: string): DryRun<ProductInput> {
  const recs = csvRecords(csv, ['sku', 'name_ar', 'name_en', 'sold_by', 'price_incl']);
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const valid: ProductInput[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const seenPlu = new Map<string, number>();
  const exists = (sql: string, v: string) => !!ctx.db.prepare(sql).get(v);

  recs.forEach((r, i) => {
    const row = i + 1;
    const err = (field: string, message: string) => issues.push({ row, field, message });
    const before = issues.length;

    const sku = r.sku ?? '';
    if (!sku) err('sku', 'missing');
    else if (seenSku.has(sku)) err('sku', `duplicate of row ${seenSku.get(sku)}`);
    else if (exists('SELECT 1 FROM products WHERE sku = ?', sku)) err('sku', 'already exists in the system');
    seenSku.set(sku, row);

    if (!r.name_ar) err('name_ar', 'missing Arabic name');
    if (!r.name_en) err('name_en', 'missing English name');

    const soldBy = (r.sold_by ?? '').toLowerCase();
    if (!['piece', 'kg'].includes(soldBy)) err('sold_by', 'must be "piece" or "kg"');

    let price = 0;
    try {
      price = parseSar(r.price_incl ?? '');
      if (price < 0) err('price_incl', 'negative');
    } catch {
      err('price_incl', `not a valid amount: "${r.price_incl}"`);
    }

    let vat = 1500;
    if (r.vat_percent) {
      try {
        vat = parseSar(r.vat_percent);
        if (vat > 10_000) err('vat_percent', 'over 100%');
        else if (vat !== 1500 && vat !== 0) warnings.push({ row, field: 'vat_percent', message: `unusual VAT rate ${r.vat_percent}% — confirm with accountant` });
      } catch {
        err('vat_percent', 'not a number');
      }
    }

    const barcode = r.barcode ?? '';
    if (barcode) {
      if (/^\d{13}$/.test(barcode) && !isValidEan13(barcode)) err('barcode', 'EAN-13 check digit is wrong');
      else if (!/^[0-9A-Za-z-]{3,32}$/.test(barcode)) err('barcode', 'invalid characters or length');
      if (seenBarcode.has(barcode)) err('barcode', `duplicate of row ${seenBarcode.get(barcode)}`);
      else if (exists('SELECT 1 FROM product_barcodes WHERE barcode = ?', barcode)) err('barcode', 'already used by another product');
      seenBarcode.set(barcode, row);
    }

    const plu = r.plu ?? '';
    if (plu) {
      if (!/^\d{1,6}$/.test(plu)) err('plu', 'must be 1–6 digits');
      if (seenPlu.has(plu)) err('plu', `duplicate of row ${seenPlu.get(plu)}`);
      else if (exists('SELECT 1 FROM plu_codes WHERE plu = ?', plu)) err('plu', 'already used');
      seenPlu.set(plu, row);
    }
    if (soldBy === 'kg' && !plu && !barcode) err('plu', 'weighed item needs a PLU for scale labels');

    if (issues.length === before) {
      valid.push({
        sku,
        nameAr: r.name_ar!,
        nameEn: r.name_en!,
        unitCode: soldBy === 'kg' ? 'KG' : 'PCS',
        sellMode: soldBy === 'kg' ? 'weight' : 'unit',
        vatRateBp: vat,
        priceIncl: price,
        barcodes: barcode ? [barcode] : [],
        plu: plu || undefined,
      });
    }
  });
  return { rows: recs.length, valid, issues, warnings };
}

/** Imports only when the dry run has no blocking issues. All rows or none. */
export function importProducts(ctx: Ctx, userId: number, csv: string, acceptWarnings = false): number {
  requirePermission(ctx, userId, 'product.manage');
  const dry = dryRunProducts(ctx, csv);
  if (dry.issues.length) throw new DomainError('VALIDATION', `Import blocked: ${dry.issues.length} problem(s). Fix them and run the check again.`);
  if (dry.warnings.length && !acceptWarnings) throw new DomainError('VALIDATION', `${dry.warnings.length} warning(s) must be confirmed before importing.`);
  return ctx.db.transaction(() => {
    for (const p of dry.valid) createProduct(ctx, userId, p);
    appendAudit(ctx, { userId, action: 'import.products', entity: 'import', details: { rows: dry.valid.length, acceptedWarnings: dry.warnings.length } });
    return dry.valid.length;
  })();
}

export function dryRunSuppliers(ctx: Ctx, csv: string): DryRun<{ name: string; phone?: string; vatNumber?: string; paymentTermsDays: number }> {
  const recs = csvRecords(csv, ['name']);
  const issues: ImportIssue[] = [];
  const valid: { name: string; phone?: string; vatNumber?: string; paymentTermsDays: number }[] = [];
  const seen = new Map<string, number>();
  recs.forEach((r, i) => {
    const row = i + 1;
    const before = issues.length;
    const name = r.name ?? '';
    if (!name) issues.push({ row, field: 'name', message: 'missing' });
    const k = name.toLowerCase();
    if (seen.has(k)) issues.push({ row, field: 'name', message: `duplicate of row ${seen.get(k)}` });
    seen.set(k, row);
    if (r.vat_number && !/^3\d{13}3$/.test(r.vat_number)) issues.push({ row, field: 'vat_number', message: 'must be 15 digits starting and ending with 3' });
    if (r.phone && !/^\+?\d{7,15}$/.test(r.phone.replace(/[\s-]/g, ''))) issues.push({ row, field: 'phone', message: 'invalid' });
    const terms = r.payment_terms_days ? Number(r.payment_terms_days) : 0;
    if (!Number.isInteger(terms) || terms < 0 || terms > 365) issues.push({ row, field: 'payment_terms_days', message: 'must be 0–365' });
    if (issues.length === before) valid.push({ name, phone: r.phone || undefined, vatNumber: r.vat_number || undefined, paymentTermsDays: terms });
  });
  return { rows: recs.length, valid, issues, warnings: [] };
}

export function importSuppliers(ctx: Ctx, userId: number, csv: string): number {
  requirePermission(ctx, userId, 'supplier.manage');
  const dry = dryRunSuppliers(ctx, csv);
  if (dry.issues.length) throw new DomainError('VALIDATION', `Import blocked: ${dry.issues.length} problem(s).`);
  return ctx.db.transaction(() => {
    for (const s of dry.valid) createSupplier(ctx, userId, s);
    appendAudit(ctx, { userId, action: 'import.suppliers', entity: 'import', details: { rows: dry.valid.length } });
    return dry.valid.length;
  })();
}
