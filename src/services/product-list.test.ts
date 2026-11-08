import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, listProducts, setProductActive } from './catalog';
import type { Ctx } from './context';
import { searchProducts } from './search';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const add = (sku: string, nameEn: string) => createProduct(ctx, u.admin, { sku, nameEn, nameAr: `عربي ${sku}`, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 100 });
const names = (r: { items: { nameEn: string }[] }) => r.items.map((p) => p.nameEn);

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  add('B1', 'banana');
  add('A1', 'Apple');
  add('C1', 'Cherry 50% off');
  setProductActive(ctx, u.admin, add('D1', 'Date'), false, 'Test');
});
afterEach(() => t.cleanup());

const list = (o: Partial<Parameters<typeof listProducts>[2]> = {}) => listProducts(ctx, u.admin, { status: 'active', offset: 0, limit: 100, ...o });

describe('listing all products', () => {
  it('shows every active product A to Z without searching', () => {
    expect(names(list())).toEqual(['Apple', 'banana', 'Cherry 50% off']);
    expect(list().total).toBe(3);
  });

  it('filters by active, inactive or all', () => {
    expect(names(list({ status: 'inactive' }))).toEqual(['Date']);
    expect(list({ status: 'inactive' }).items[0]!.active).toBe(false);
    expect(names(list({ status: 'all' }))).toEqual(['Apple', 'banana', 'Cherry 50% off', 'Date']);
  });

  it('pages through a long list and always gives the full count', () => {
    expect(list({ limit: 2 })).toMatchObject({ total: 3 });
    expect(names(list({ limit: 2 }))).toEqual(['Apple', 'banana']);
    expect(names(list({ limit: 2, offset: 2 }))).toEqual(['Cherry 50% off']);
  });

  it('narrows by name or SKU, in any status', () => {
    expect(names(list({ status: 'inactive', text: 'dat' }))).toEqual(['Date']);
    expect(names(list({ status: 'all', text: 'a1' }))).toEqual(['Apple']);
    expect(list({ status: 'all', text: 'zzz' })).toEqual({ items: [], total: 0 });
  });

  it('treats % and _ as plain characters', () => {
    expect(names(list({ text: '50%' }))).toEqual(['Cherry 50% off']);
    expect(names(list({ text: '%' }))).toEqual(['Cherry 50% off']);
    expect(names(list({ text: '_' }))).toEqual([]);
  });

  it('needs product.manage', () => {
    expect(() => listProducts(ctx, u.cashier, { status: 'all', offset: 0, limit: 10 })).toThrow();
  });

  it('a product turned back on can be searched and sold again', () => {
    const id = list({ status: 'inactive' }).items[0]!.id;
    expect(searchProducts(ctx, 'Date').map((h) => h.product.id)).not.toContain(id);
    setProductActive(ctx, u.admin, id, true, 'Back in range');
    expect(searchProducts(ctx, 'Date').map((h) => h.product.id)).toContain(id);
    expect(names(list())).toContain('Date');
  });
});
