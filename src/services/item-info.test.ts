import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, itemInfo } from './catalog';
import type { Ctx } from './context';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let admin: number;
let product: number;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  admin = seedUsers(ctx).admin;
  product = createProduct(ctx, admin, { sku: 'T-1', nameAr: 'تجربة', nameEn: 'Test item', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 900 });
});
afterEach(() => t.cleanup());

describe('item information', () => {
  it('shows price and stock on hand', () => {
    const supplierId = createSupplier(ctx, admin, { name: 'Test supplier' });
    receiveGoods(ctx, admin, { supplierId, lines: [{ productId: product, qty: 12_000, unitCost: 500 }] });
    expect(itemInfo(ctx, product)).toMatchObject({ productId: product, sku: 'T-1', nameEn: 'Test item', priceIncl: 900, vatRateBp: 1500, sellMode: 'unit', stockQty: 12_000 });
  });

  it('shows zero for an item never received', () => {
    expect(itemInfo(ctx, product).stockQty).toBe(0);
  });

  it('never gives the cost to the till', () => {
    expect(Object.keys(itemInfo(ctx, product)).join(',').toLowerCase()).not.toContain('cost');
  });

  it('refuses an unknown item', () => {
    expect(() => itemInfo(ctx, 99_999)).toThrow('not found');
  });
});
