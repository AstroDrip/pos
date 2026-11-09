import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIN_PRODUCT_SALES, MIN_STORE_DAYS } from '../core/rank';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { demandPatterns, resetDemandCache } from './demand';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { searchProducts } from './search';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

const DAY = 86_400_000;
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let sup: number;
let n = 0;

const product = (sku: string, name: string, o: { stock?: number; barcodes?: string[] } = {}) => {
  const id = createProduct(ctx, u.admin, { sku, nameAr: name, nameEn: name, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000, barcodes: o.barcodes });
  if (o.stock !== 0) receiveGoods(ctx, u.admin, { supplierId: sup, reference: `R-${sku}`, lines: [{ productId: id, qty: o.stock ?? 500_000, unitCost: 500 }] });
  return id;
};
const sell = (productId: number) => finalizeSale(ctx, u.cashier, { idempotencyKey: `rank-${++n}-key`, lines: [{ productId, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
const names = (q: string) => searchProducts(ctx, q).map((h) => h.product.nameEn);

beforeEach(() => {
  resetDemandCache();
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  sup = createSupplier(ctx, u.admin, { name: 'Farm' });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('search order', () => {
  it('an exact barcode outranks a much more popular name match', () => {
    product('X1', 'Milk 628000', { barcodes: ['6280000000001'] });
    const popular = product('X2', 'Other 6280000000001 drink');
    for (let i = 0; i < 12; i++) sell(popular);
    resetDemandCache();
    expect(searchProducts(ctx, '6280000000001')[0]!.matchedBy).toBe('barcode');
  });

  it('an exact SKU outranks a popular item', () => {
    product('RICE5', 'Plain bag');
    const popular = product('Z9', 'RICE5 special');
    for (let i = 0; i < 12; i++) sell(popular);
    resetDemandCache();
    expect(names('RICE5')[0]).toBe('Plain bag');
  });

  it('an out-of-stock item sorts after an in-stock item in the same level, and is still listed', () => {
    product('A1', 'Apple red', { stock: 0 });
    product('A2', 'Apple redder');
    expect(names('Apple')).toEqual(['Apple redder', 'Apple red']);
    const [inStock, out] = searchProducts(ctx, 'Apple');
    expect(inStock!.signals.inStock).toBe(true);
    expect(out!.signals.inStock).toBe(false);
  });

  it('marks an often-bought item', () => {
    const a = product('A1', 'Apple');
    product('A2', 'Apricot');
    for (let i = 0; i < 40; i++) sell(a);
    resetDemandCache();
    const hits = searchProducts(ctx, 'Ap');
    expect(hits.find((h) => h.product.nameEn === 'Apple')!.signals.often).toBe(true);
    expect(hits.find((h) => h.product.nameEn === 'Apricot')!.signals.often).toBe(false);
  });
});

describe('time and day patterns', () => {
  it(`a store with under ${MIN_STORE_DAYS} days of sales has no pattern`, () => {
    const a = product('A1', 'Apple');
    for (let i = 0; i < MIN_PRODUCT_SALES + 2; i++) sell(a);
    t.advance(10 * DAY);
    resetDemandCache();
    expect(demandPatterns(ctx).size).toBe(0);
  });

  it('a product with too few sales has no pattern', () => {
    const a = product('A1', 'Apple');
    sell(a);
    t.advance((MIN_STORE_DAYS + 1) * DAY);
    resetDemandCache();
    expect(demandPatterns(ctx).has(a)).toBe(false);
  });

  it('an item sold mostly at this time gets the tag; one sold at other times does not', () => {
    const now = product('A1', 'Apple');
    const other = product('A2', 'Apricot');
    // Every sale of Apple is at this hour; Apricot's sales are 6 hours away from it.
    for (let d = 0; d < 10; d++) {
      sell(now);
      t.advance(6 * 3_600_000);
      sell(other);
      t.advance(18 * 3_600_000);
    }
    t.advance((MIN_STORE_DAYS - 10) * DAY);
    resetDemandCache();
    const p = demandPatterns(ctx);
    expect(p.get(now)!.hourShare).toBe(1);
    expect(p.get(other)!.hourShare).toBe(0);
    const hits = searchProducts(ctx, 'Ap');
    expect(hits.find((h) => h.product.id === now)!.signals.now).toBe(true);
    expect(hits.find((h) => h.product.id === other)!.signals.now).toBe(false);
  });
});

describe('speed', () => {
  it('search stays quick with 20,000 products', () => {
    ctx.db.transaction(() => {
      for (let i = 0; i < 20_000; i++) createProduct(ctx, u.admin, { sku: `S${i}`, nameAr: `منتج ${i}`, nameEn: `Item number ${i}`, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
    })();
    resetDemandCache();
    const times = Array.from({ length: 20 }, () => {
      const start = performance.now();
      searchProducts(ctx, 'item');
      return performance.now() - start;
    }).sort((a, b) => a - b);
    expect(times[18]!).toBeLessThan(500); // about 33 ms on a quiet machine; the test suite shares the machine
  }, 120_000);
});
