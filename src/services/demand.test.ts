import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { DEMAND_MIN_SALES, demandScores, resetDemandCache } from './demand';
import { holdBill } from './held-bills';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { createRefund } from './refunds';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

const DAY = 86_400_000;
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let n = 0;
let a: number;
let b: number;
let sup: number;

const product = (sku: string, name: string) => {
  const id = createProduct(ctx, u.admin, { sku, nameAr: name, nameEn: name, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
  receiveGoods(ctx, u.admin, { supplierId: sup, reference: `R-${sku}`, lines: [{ productId: id, qty: 500_000, unitCost: 500 }] });
  return id;
};
const sell = (productId: number, qty = 1000) =>
  finalizeSale(ctx, u.cashier, { idempotencyKey: `dem-${++n}-key`, lines: [{ productId, qty }], payments: [{ tender: 'cash', amount: qty }] });
const refund = (invoiceNo: string, qty: number) =>
  createRefund(ctx, u.cashier, { requestKey: `dem-rf-${++n}`, invoiceNo, reason: 'test', lines: [{ saleLineNo: 1, qty, restock: true }], approverId: u.supervisor });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  sup = createSupplier(ctx, u.admin, { name: 'Test Supplier' });
  a = product('A1', 'Apricot');
  b = product('B1', 'Banana');
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('demandScores', () => {
  it('counts sales, not units', () => {
    for (let i = 0; i < DEMAND_MIN_SALES; i++) sell(a, 5000);
    for (let i = 0; i < DEMAND_MIN_SALES; i++) sell(b, 1000);
    const s = demandScores(ctx);
    expect(s.get(a)).toBeCloseTo(s.get(b)!, 10);
  });

  it('gives nothing below three sales', () => {
    sell(a);
    sell(a);
    expect(DEMAND_MIN_SALES).toBe(3);
    expect(demandScores(ctx).has(a)).toBe(false);
  });

  it('weighs recent sales more than old ones', () => {
    for (let i = 0; i < 3; i++) sell(b);
    t.advance(60 * DAY);
    for (let i = 0; i < 3; i++) sell(a);
    const s = demandScores(ctx);
    expect(s.get(a)!).toBeGreaterThan(s.get(b)!);
    expect(s.get(b)!).toBeGreaterThan(0);
    // 3 sales today: 0.5*3/7 + 0.3*3/30 + 0.2*3/90; 3 sales 60 days ago: only the 90-day window
    expect(s.get(a)).toBeCloseTo(0.5 * 3 / 7 + 0.3 * 3 / 30 + 0.2 * 3 / 90, 10);
    expect(s.get(b)).toBeCloseTo(0.2 * 3 / 90, 10);
  });

  it('forgets sales older than 90 days', () => {
    for (let i = 0; i < 3; i++) sell(a);
    t.advance(91 * DAY);
    expect(demandScores(ctx).has(a)).toBe(false);
  });

  it('fully refunded scores zero', () => {
    for (let i = 0; i < 3; i++) refund(sell(a).invoiceNo, 1000);
    expect(demandScores(ctx).has(a)).toBe(false);
  });

  it('a half refund subtracts half a sale', () => {
    for (let i = 0; i < 3; i++) sell(a, 1000);
    refund(sell(a, 2000).invoiceNo, 1000);
    expect(demandScores(ctx).get(a)).toBeCloseTo(0.5 * 3.5 / 7 + 0.3 * 3.5 / 30 + 0.2 * 3.5 / 90, 10);
  });

  it('refreshes after a new sale without a manual reset', () => {
    for (let i = 0; i < 3; i++) sell(a);
    const first = demandScores(ctx).get(a)!;
    sell(a);
    expect(demandScores(ctx).get(a)!).toBeGreaterThan(first);
  });

  it('new sales and refunds added after a score give the same result as a full recompute', () => {
    for (let i = 0; i < 3; i++) sell(a);
    for (let i = 0; i < 3; i++) sell(b);
    demandScores(ctx); // warm the cache
    t.advance(60_000);
    const s1 = sell(b, 2000);
    refund(sell(a).invoiceNo, 1000);
    refund(s1.invoiceNo, 1000);
    const incremental = new Map(demandScores(ctx));
    resetDemandCache();
    const full = demandScores(ctx);
    expect([...incremental.keys()].sort()).toEqual([...full.keys()].sort());
    for (const [k, v] of full) expect(incremental.get(k)).toBeCloseTo(v, 12);
    expect(full.get(b)).toBeCloseTo(0.5 * 3.5 / 7 + 0.3 * 3.5 / 30 + 0.2 * 3.5 / 90, 10); // 4 sales, one half refunded
  });

  it('a sale older than 7 days leaves the 7-day window but stays in the 30-day one', () => {
    for (let i = 0; i < 5; i++) sell(a);
    t.advance(10 * 86_400_000);
    expect(demandScores(ctx).get(a)).toBeCloseTo(0.3 * 5 / 30 + 0.2 * 5 / 90, 10);
  });

  it('ageing a warm cache across the 7, 30 and 90-day edges matches a full recompute', () => {
    for (let i = 0; i < 4; i++) sell(a);
    refund(sell(a, 2000).invoiceNo, 1000);
    t.advance(5 * 86_400_000);
    for (let i = 0; i < 3; i++) sell(b);
    demandScores(ctx); // warm
    for (const days of [3, 25, 61, 5]) {
      t.advance(days * 86_400_000);
      const aged = new Map(demandScores(ctx));
      resetDemandCache();
      const full = demandScores(ctx);
      expect([...aged.keys()].sort()).toEqual([...full.keys()].sort());
      for (const [k, v] of full) expect(aged.get(k)).toBeCloseTo(v, 12);
    }
  });

  it('does not count held bills', () => {
    for (let i = 0; i < 5; i++) holdBill(ctx, u.cashier, `h${i}`, { lines: [{ productId: a, qty: 1000 }] });
    expect(demandScores(ctx).has(a)).toBe(false);
  });
});
