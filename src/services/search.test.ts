import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { searchProducts } from './search';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const ids: Record<string, number> = {};
let n = 0;

const P = (sku: string, nameEn: string, nameAr: string, opts: { plu?: string } = {}) =>
  (ids[sku] = createProduct(ctx, u.admin, { sku, nameEn, nameAr, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000, plu: opts.plu }));
const sellTimes = (sku: string, times: number) => {
  for (let i = 0; i < times; i++) finalizeSale(ctx, u.cashier, { idempotencyKey: `srch-${++n}-key`, lines: [{ productId: ids[sku]!, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
};
const names = (q: string, limit?: number) => searchProducts(ctx, q, limit).map((h) => h.product.nameEn);

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  for (const k of Object.keys(ids)) delete ids[k]; // ids from the previous test belong to another database
  P('APL', 'Apple', 'تفاح');
  P('APR', 'Apricot', 'مشمش');
  P('BAN', 'Banana', 'موز');
  P('GAP', 'Green Apple', 'تفاح أخضر');
  P('RZ1', 'Rice Egyptian', 'أرز مصري');
  P('RZ2', 'Rice Basmati', 'ارز بسمتي');
  P('SVN', '7up 330ml', 'سفن اب');
  P('PLU7', 'Parsley bunch', 'بقدونس', { plu: '7' });
  const sup = createSupplier(ctx, u.admin, { name: 'Supplier' });
  receiveGoods(ctx, u.admin, { supplierId: sup, lines: Object.values(ids).map((id) => ({ productId: id, qty: 100_000, unitCost: 100 })) });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('first-character search', () => {
  it('one letter returns products whose name starts with it, and only those', () => {
    expect(names('a').sort()).toEqual(['Apple', 'Apricot']);
  });

  it('arabic one letter folds alef forms', () => {
    // stored as أرز and ارز: both start with alef after normalisation
    const ar = searchProducts(ctx, 'ا').map((h) => h.product.sku);
    expect(ar).toEqual(expect.arrayContaining(['RZ1', 'RZ2']));
    expect(searchProducts(ctx, 'أ').map((h) => h.product.sku)).toEqual(expect.arrayContaining(['RZ1', 'RZ2']));
  });

  it('a code beats a one-letter name match', () => {
    const h = searchProducts(ctx, '7');
    expect(h[0]).toMatchObject({ matchedBy: 'plu', product: { sku: 'PLU7' } });
    expect(h.map((x) => x.product.sku)).toContain('SVN');
  });

  it('respects the limit for one letter', () => {
    expect(names('a', 1)).toHaveLength(1);
  });
});

describe('demand ranking', () => {
  it('breaks ties inside a match level', () => {
    expect(names('ap')[0]).toBe('Apple'); // no sales: shorter name first, as before
    sellTimes('APR', 3);
    expect(names('ap').slice(0, 2)).toEqual(['Apricot', 'Apple']);
  });

  it('never beats a stronger match', () => {
    sellTimes('APR', 10);
    expect(searchProducts(ctx, 'apple')[0]).toMatchObject({ matchedBy: 'name', product: { sku: 'APL' } });
    // "Green Apple" is a word-prefix match: it stays below every name-prefix match even when it sells most
    sellTimes('GAP', 10);
    const ap = names('ap');
    expect(ap.indexOf('Green Apple')).toBeGreaterThan(ap.indexOf('Apple'));
  });

  it('does not penalise new products', () => {
    sellTimes('APR', 5);
    P('APN', 'Apple New', 'تفاح جديد');
    // both name-prefix matches come first; "Green Apple" (a word match, allowed from 2 letters) follows
    expect(names('app')).toEqual(['Apple', 'Apple New', 'Green Apple']);
  });

  it('finds a best seller even when it is not among the first names alphabetically', () => {
    for (let i = 1; i <= 12; i++) P(`BB${i}`, `Biscuit ${String(i).padStart(2, '0')}`, `بسكويت ${i}`);
    P('BZC', 'Bz Cola', 'بز كولا');
    receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'S2' }), lines: [{ productId: ids.BZC!, qty: 100_000, unitCost: 100 }] });
    sellTimes('BZC', 3);
    expect(names('b', 8)[0]).toBe('Bz Cola');
    expect(names('bz', 12)[0]).toBe('Bz Cola');
  });
});
