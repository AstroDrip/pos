import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storeDay } from '../core/store-time';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { cashFlow, ownerKpis } from './financials';
import { receiveGoods } from './inventory';
import { postEntry } from './ledger';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number;
const today = () => storeDay(ctx.now());
const group = (id: string) => cashFlow(ctx, u.admin, today(), today()).groups.find((g) => g.id === id)!.amount;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Farm' }), lines: [{ productId: item, qty: 100_000, unitCost: 500 }] });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('cash flow', () => {
  it('opening + net = closing, and closing equals cash and bank', () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: 'cash-flow-1', lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
    const r = cashFlow(ctx, u.admin, today(), today());
    expect(r.opening + r.net).toBe(r.closing);
    expect(r.closing).toBe(ownerKpis(ctx, u.admin, today(), today()).cashAndBank);
  });

  it("a sale's card part counts under sales", () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: 'cash-flow-2', lines: [{ productId: item, qty: 2000 }], payments: [{ tender: 'cash', amount: 500 }, { tender: 'card', amount: 1500 }] });
    expect(group('sales')).toBe(2000);
  });

  it('an unknown source lands in other, so nothing is dropped', () => {
    postEntry(ctx, { date: today(), sourceType: 'mystery', sourceId: 1, memo: 'test', lines: [{ account: '1010', debit: 700 }, { account: '3000', credit: 700 }] });
    expect(group('other')).toBe(700);
  });

  it('money before the period is the opening balance', () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: 'cash-flow-3', lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
    t.advance(2 * 86_400_000);
    const r = cashFlow(ctx, u.admin, today(), today());
    expect(r).toMatchObject({ opening: 1000, net: 0, closing: 1000 });
  });

  it('an empty period is zero with opening = closing', () => {
    const r = cashFlow(ctx, u.admin, '2020-01-01', '2020-01-02');
    expect(r).toMatchObject({ opening: 0, net: 0, closing: 0 });
    expect(r.groups.every((g) => g.amount === 0)).toBe(true);
  });

  it('needs finance.view', () => expect(() => cashFlow(ctx, u.cashier, today(), today())).toThrow());

  it('rejects a backwards range', () => expect(() => cashFlow(ctx, u.admin, '2026-02-02', '2026-02-01')).toThrow());
});
