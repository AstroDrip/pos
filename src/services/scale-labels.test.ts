// Weighed-product labels through the configurable layout (ADR-3), end to end: lookup → sale → refund.
// SYNTHETIC layout only. It follows the owner's described order (item code, quantity, PLU) with example lengths.
// The store's real layout is unverified until a real label is decoded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, lookup, saveScaleLayout, scaleLayouts, setProductActive } from './catalog';
import { DomainError, type Ctx } from './context';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { createRefund } from './refunds';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let lamb: number; // 49.99 SAR / kg, PLU 200, SKU LAMB
let k = 0;
const key = () => `scale-key-${++k}-xx`;
const code = (item: string, grams: number, plu: string) => `2${item}${String(grams).padStart(5, '0')}${plu}`;
const err = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? `${e.code}: ${e.message}` : `THROW ${(e as Error).message}`;
  }
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  lamb = createProduct(ctx, u.admin, { sku: 'LAMB', nameEn: 'Lamb Leg', nameAr: 'فخذ غنم', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 4999, plu: '200' });
  createProduct(ctx, u.admin, { sku: 'BAN', nameEn: 'Banana', nameAr: 'موز', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 599, plu: '125' });
  createProduct(ctx, u.admin, { sku: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 650, plu: '300', barcodes: ['2000000000017'] });
  // item code (4) + grams (5) + PLU (3), prefix "2" — 13 digits, no check digit
  saveScaleLayout(ctx, u.admin, { name: 'Owner order (synthetic)', spec: 'lit=2 item:4 weight_g:5 plu:3', itemMatches: 'plu', active: true });
  const sup = createSupplier(ctx, u.admin, { name: 'S' });
  receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: lamb, qty: 50_000, unitCost: 3000 }] });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('configurable scale labels', () => {
  it('item code + quantity + PLU: right product, weight and price; label kept on the sale line', () => {
    const c = code('0200', 1250, '200');
    const r = lookup(ctx, c)!;
    expect(r).toMatchObject({ source: 'scale', qty: 1250, scanCode: c, product: { id: lamb } });
    const s = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: lamb, qty: r.qty, scanCode: r.scanCode }], payments: [{ tender: 'cash', amount: 10_000 }] });
    expect(s.totalIncl).toBe(6249); // 1.250 kg x 49.99 = 62.4875 -> 62.49
    expect(ctx.db.prepare('SELECT scan_code FROM sale_lines WHERE sale_id = ?').get(s.saleId)).toEqual({ scan_code: c });
  });

  it('quantities 1, 100, 250, 500, 1000 g and the maximum give exact bills', () => {
    for (const [g, price] of [[1, 5], [100, 500], [250, 1250], [500, 2500], [1000, 4999], [30_000, 149_970]] as const) {
      const r = lookup(ctx, code('0200', g, '200'))!;
      expect(r.qty).toBe(g);
      const s = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: lamb, qty: r.qty }], payments: [{ tender: 'cash', amount: 200_000 }] });
      expect([g, s.totalIncl]).toEqual([g, price]);
    }
  });

  it('refuses zero, over-maximum, unknown, mismatched, inactive and non-weighed labels with clear messages', () => {
    expect(err(() => lookup(ctx, code('0200', 0, '200')))).toMatch(/zero weight/);
    expect(err(() => lookup(ctx, code('0200', 30_001, '200')))).toMatch(/above the allowed 30000 g/);
    expect(err(() => lookup(ctx, code('0200', 500, '999')))).toMatch(/NOT_FOUND: Scale label PLU 999/);
    expect(err(() => lookup(ctx, code('0999', 500, '200')))).toMatch(/NOT_FOUND: Scale label item code 0999/);
    expect(err(() => lookup(ctx, code('0125', 500, '200')))).toMatch(/point to different products/);
    expect(err(() => lookup(ctx, code('0300', 500, '300')))).toMatch(/not a weighed product/);
    setProductActive(ctx, u.admin, lamb, false, 'test');
    expect(err(() => lookup(ctx, code('0200', 500, '200')))).toMatch(/inactive/);
  });

  it('truncated or different codes are not read as labels; an ordinary barcode still works', () => {
    expect(lookup(ctx, '200200125020')).toBeNull(); // 12 digits: not this layout, nothing else matches
    expect(lookup(ctx, '2000000000017')).toMatchObject({ source: 'barcode', product: { sku: 'MILK' } }); // exact barcode wins first
  });

  it('a weighed item bought by label can be part-refunded by weight', () => {
    const r = lookup(ctx, code('0200', 1200, '200'))!;
    const s = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: lamb, qty: r.qty, scanCode: r.scanCode }], payments: [{ tender: 'cash', amount: 10_000 }] });
    const ref = createRefund(ctx, u.cashier, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'test', lines: [{ saleLineNo: 1, qty: 500, restock: false }], approverId: u.supervisor });
    expect(ref.totalIncl).toBe(2500);
  });

  it('only settings.manage can change layouts; bad layouts are refused; changes are audited', () => {
    expect(err(() => saveScaleLayout(ctx, u.supervisor, { name: 'x', spec: 'lit=2 item:4 weight_g:5 plu:3', itemMatches: 'plu', active: true }))).toMatch(/PERMISSION_DENIED/);
    expect(err(() => saveScaleLayout(ctx, u.admin, { name: 'bad', spec: 'item:5 weight_g:5', itemMatches: 'plu', active: true }))).toMatch(/fixed prefix/);
    const [l] = scaleLayouts(ctx);
    expect(l).toMatchObject({ spec: 'lit=2 item:4 weight_g:5 plu:3', active: true });
    saveScaleLayout(ctx, u.admin, { id: l!.id, name: l!.name, spec: l!.spec, itemMatches: 'plu', active: false });
    expect(lookup(ctx, code('0200', 500, '200'))).toBeNull(); // inactive layout is not used
    const n = (ctx.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'scale.layout_saved'").get() as { n: number }).n;
    expect(n).toBe(2);
  });
});
