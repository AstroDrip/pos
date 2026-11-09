// Fixed made-up labels. The store's real printed label has not been supplied, so its format is still to be confirmed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanBuffer } from '../core/scan-buffer';
import { createProduct, saveScaleLayout } from './catalog';
import { DomainError, type Ctx } from './context';
import { diagnoseLabel, drawerCheck, paperWidth, setPaperWidth, testReceiptData } from './hardware';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;

const grams = (item: string, g: number, plu: string) => `2${item}${String(g).padStart(5, '0')}${plu}`;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  createProduct(ctx, u.admin, { sku: 'CHEESE', nameEn: 'Made Up Cheese', nameAr: 'جبن', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 4_000, plu: '125' });
  createProduct(ctx, u.admin, { sku: 'WATER', nameEn: 'Made Up Water', nameAr: 'ماء', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 200, barcodes: ['6281000000014'] });
});
afterEach(() => t.cleanup());

describe('label reader: item code, then quantity, then PLU', () => {
  beforeEach(() => void saveScaleLayout(ctx, u.admin, { name: 'Grams', spec: 'lit=2 item:4 weight_g:5 plu:3', itemMatches: 'plu', active: true }));

  it('shows every part, the product and the price', () => {
    const d = diagnoseLabel(ctx, u.admin, grams('0125', 1_250, '125'));
    expect(d).toMatchObject({ kind: 'scale', layout: 'Grams', itemCode: '0125', plu: '125', weightGrams: 1_250, qty: 1_250, unit: 'kg', linePrice: 5_000, errors: [] });
    expect(d.product).toMatchObject({ sku: 'CHEESE', unitPrice: 4_000 });
  });

  it('an unknown PLU is explained', () => {
    expect(diagnoseLabel(ctx, u.admin, grams('0999', 1_250, '999')).errors.join()).toMatch(/not set up/);
  });

  it('item code and PLU that disagree are refused', () => {
    createProduct(ctx, u.admin, { sku: 'OTHER', nameEn: 'Other', nameAr: 'آخر', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 1_000, plu: '126' });
    expect(diagnoseLabel(ctx, u.admin, grams('0126', 500, '125')).errors.join()).toMatch(/different products/);
  });

  it('zero weight is refused', () => {
    expect(diagnoseLabel(ctx, u.admin, grams('0125', 0, '125')).errors.join()).toMatch(/zero weight/);
  });

  it('keeps the parts when the product check fails, so the fault can be seen', () => {
    expect(diagnoseLabel(ctx, u.admin, grams('0125', 0, '125'))).toMatchObject({ itemCode: '0125', plu: '125', weightGrams: 0, linePrice: null });
  });
});

describe('grams against kilograms', () => {
  it('the same digits mean different weights under each layout, and the sum follows', () => {
    saveScaleLayout(ctx, u.admin, { name: 'Kg with 3 decimals', spec: 'lit=2 item:4 weight_kg3:5 plu:3', itemMatches: 'plu', active: true });
    expect(diagnoseLabel(ctx, u.admin, grams('0125', 1_250, '125'))).toMatchObject({ weightGrams: 1_250, qty: 1_250, linePrice: 5_000 });
  });

  it('two decimals: 00125 is 1.25 kg', () => {
    saveScaleLayout(ctx, u.admin, { name: 'Kg with 2 decimals', spec: 'lit=2 item:4 weight_kg2:5 plu:3', itemMatches: 'plu', active: true });
    expect(diagnoseLabel(ctx, u.admin, grams('0125', 125, '125'))).toMatchObject({ weightGrams: 1_250, linePrice: 5_000 });
  });
});

describe('other codes', () => {
  it('a normal barcode finds its product at one piece', () => {
    expect(diagnoseLabel(ctx, u.admin, '6281000000014')).toMatchObject({ kind: 'barcode', qty: 1_000, unit: 'piece', linePrice: 200, validEan13: true });
  });
  it('an unknown code and an empty scan say so', () => {
    expect(diagnoseLabel(ctx, u.admin, '123456').errors).toEqual(['No product uses this code']);
    expect(diagnoseLabel(ctx, u.admin, '  ').errors).toEqual(['Nothing was scanned']);
  });
  it('only an administrator can use it', () => {
    expect(() => diagnoseLabel(ctx, u.cashier, '123456')).toThrow(DomainError);
  });
});

describe('scanner timing', () => {
  const scan = (b: ScanBuffer, code: string, from: number) => {
    let r = null;
    let at = from;
    for (const ch of code) b.key(ch, (at += 5));
    r = b.key('Enter', (at += 5));
    return r;
  };

  it('a burst is one scan; a slow typist is not', () => {
    expect(scan(new ScanBuffer(), '6281000000014', 1000)).toEqual({ code: '6281000000014', possibleDuplicate: false });
    const b = new ScanBuffer();
    let at = 0;
    for (const ch of '123456') b.key(ch, (at += 200));
    expect(b.key('Enter', (at += 200))).toBeNull();
  });

  it('rapid different codes are separate scans', () => {
    const b = new ScanBuffer();
    expect(scan(b, '11111111', 1000)?.possibleDuplicate).toBe(false);
    expect(scan(b, '22222222', 1100)?.possibleDuplicate).toBe(false);
  });

  it('the same code twice within the window is flagged, and later it is a normal repeat', () => {
    const b = new ScanBuffer();
    scan(b, '11111111', 1000);
    expect(scan(b, '11111111', 1100)?.possibleDuplicate).toBe(true);
    expect(scan(b, '11111111', 3000)?.possibleDuplicate).toBe(false);
  });
});

describe('printer and drawer tools', () => {
  it('the test slip adds up and cannot be taken for an invoice', () => {
    const r = testReceiptData('2026-11-05T08:00:00.000Z');
    expect(r.invoiceNo).toBe('TEST - NOT A SALE');
    expect(r.lines.reduce((s, l) => s + l.lineIncl, 0)).toBe(r.totalIncl);
    expect(r.totalExcl + r.totalVat).toBe(r.totalIncl);
    expect(r.lines.some((l) => l.nameEn.length > 40)).toBe(true);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(0);
  });

  it('paper width defaults to 80 mm and can be set to 58', () => {
    expect(paperWidth(ctx)).toBe(80);
    setPaperWidth(ctx, u.admin, 58);
    expect(paperWidth(ctx)).toBe(58);
  });

  it('the drawer check only reads cash figures, and says the app cannot open a drawer', () => {
    openShift(ctx, u.admin, 5_000);
    expect(drawerCheck(ctx, u.admin)).toEqual({ control: 'none', openShift: { expectedCash: 5_000 }, lastClosed: null, shiftCashProblems: 0 });
  });
});
