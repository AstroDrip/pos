import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { isValidEan13 } from '../core/scale-barcode';
import { looksLike, parseLabel, type ParsedLabel } from '../core/scale-layout';
import { lookup, scaleLayouts } from './catalog';
import { DomainError, type Ctx } from './context';
import { CHECKS } from './integrity';
import type { ReceiptData } from './sales';
import { openShiftId, shiftSummary } from './shifts';
import { requirePermission } from './users';

// Tools for checking a scanner, scale label, printer and till drawer. Nothing here sells, prints a real sale or opens a drawer.

export interface LabelDiagnosis {
  raw: string;
  length: number;
  validEan13: boolean;
  kind: 'barcode' | 'plu' | 'sku' | 'scale' | 'unknown';
  layout: string | null;
  itemCode: string | null;
  plu: string | null;
  weightGrams: number | null;
  priceOnLabel: number | null;
  pieces: number | null;
  qty: number | null; // thousandths of the selling unit
  unit: string | null;
  product: { sku: string; name: string; unitPrice: number; sellMode: string } | null;
  linePrice: number | null;
  errors: string[];
}

export function diagnoseLabel(ctx: Ctx, userId: number, rawInput: string): LabelDiagnosis {
  requirePermission(ctx, userId, 'settings.manage');
  const raw = rawInput.trim();
  const out: LabelDiagnosis = { raw, length: raw.length, validEan13: isValidEan13(raw), kind: 'unknown', layout: null, itemCode: null, plu: null, weightGrams: null, priceOnLabel: null, pieces: null, qty: null, unit: null, product: null, linePrice: null, errors: [] };
  if (!raw) {
    out.errors.push('Nothing was scanned');
    return out;
  }
  const layout = scaleLayouts(ctx, true).find((l) => looksLike(raw, l));
  if (layout) {
    out.layout = layout.name;
    try {
      const p: ParsedLabel = parseLabel(raw, layout);
      out.itemCode = p.itemCode ?? null;
      out.plu = p.plu ?? null;
      out.weightGrams = p.weightGrams ?? null;
      out.priceOnLabel = p.priceHalalas ?? null;
      out.pieces = p.pieces ?? null;
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
  try {
    const r = lookup(ctx, raw);
    if (!r) {
      out.errors.push('No product uses this code');
      return out;
    }
    out.kind = r.source;
    out.qty = r.qty;
    out.unit = r.product.sellMode === 'weight' ? 'kg' : 'piece';
    out.product = { sku: r.product.sku, name: r.product.nameEn, unitPrice: r.product.priceIncl, sellMode: r.product.sellMode };
    out.linePrice = roundDiv(r.product.priceIncl * r.qty, MILLI_PER_UNIT);
  } catch (e) {
    if (e instanceof DomainError) out.errors.push(e.message);
    else throw e;
  }
  return out;
}

/** Made-up slip with awkward content. It has no invoice number, so it cannot be taken for a tax invoice. */
export function testReceiptData(now: string): ReceiptData {
  const line = (nameEn: string, qty: number, unitPriceIncl: number) => {
    const lineIncl = roundDiv(unitPriceIncl * qty, MILLI_PER_UNIT);
    const lineExcl = roundDiv(lineIncl * 10_000, 11_500);
    return { nameAr: '', nameEn, qty, unitPriceIncl, discount: 0, lineIncl, lineVat: lineIncl - lineExcl, lineExcl, vatRateBp: 1500 };
  };
  const lines = [line('TEST ITEM', 1_000, 500), line('A very long made-up product name that has to wrap neatly on a narrow slip 1.5 litre', 2_000, 1_250), line('Loose item sold by weight', 1_250, 2_000)];
  const totalIncl = lines.reduce((s, l) => s + l.lineIncl, 0);
  const totalExcl = lines.reduce((s, l) => s + l.lineExcl, 0);
  return { invoiceNo: 'TEST - NOT A SALE', uuid: 'test', createdAt: now, cashier: 'Printer test', lines, totalExcl, totalVat: totalIncl - totalExcl, totalIncl, totalDiscount: 0, payments: [{ tender: 'cash', amount: totalIncl }], changeGiven: 0 } as ReceiptData;
}

export function paperWidth(ctx: Ctx): 58 | 80 {
  const r = ctx.db.prepare("SELECT value FROM settings WHERE key = 'receipt_paper_mm'").get() as { value: string } | undefined;
  return r?.value === '58' ? 58 : 80;
}

export function setPaperWidth(ctx: Ctx, userId: number, mm: 58 | 80): void {
  requirePermission(ctx, userId, 'settings.manage');
  ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('receipt_paper_mm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(mm));
}

export interface DrawerCheck {
  control: 'none';
  openShift: { expectedCash: number } | null;
  lastClosed: { expectedCash: number; countedCash: number | null; difference: number | null } | null;
  shiftCashProblems: number;
}

/** Reads cash figures only. This app has no command that opens a drawer. */
export function drawerCheck(ctx: Ctx, userId: number): DrawerCheck {
  requirePermission(ctx, userId, 'settings.manage');
  const id = openShiftId(ctx);
  const last = ctx.db.prepare("SELECT expected_cash AS e, counted_cash AS c FROM register_shifts WHERE status = 'closed' ORDER BY id DESC LIMIT 1").get() as { e: number; c: number | null } | undefined;
  return {
    control: 'none',
    openShift: id === null ? null : { expectedCash: shiftSummary(ctx, id).expectedCash },
    lastClosed: last ? { expectedCash: last.e, countedCash: last.c, difference: last.c === null ? null : last.c - last.e } : null,
    shiftCashProblems: CHECKS.find((c) => c.id === 'shift_cash')!.run(ctx).length,
  };
}
