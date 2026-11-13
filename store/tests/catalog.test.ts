import { beforeAll, describe, expect, it } from 'vitest';
import { availabilityOf, getProduct, listCategories, listProducts, stockIsFresh, suggest } from '../src/server/catalog-core.ts';
import { cartBody, quoteCart } from '../src/server/cart-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { makeCloud, type TestCloud } from './helpers.ts';

let c: TestCloud;

interface Item { id: number; name: string; cat: number | null; price?: number; status?: string; onHand?: number | null; reserved?: number; safety?: number; active?: boolean; kind?: string; mode?: string; featured?: boolean; barcode?: string; image?: string }

async function add(i: Item) {
  await c.owner.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, category_id, unit, sell_mode, item_kind, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, 1500, $9)`, [i.id, `SKU-${i.id}`, i.name, i.cat, i.mode === 'weight' ? 'kg' : 'piece', i.mode ?? 'unit', i.kind ?? 'stock', i.price ?? 1150, i.active ?? true]);
  await c.owner.query('INSERT INTO commerce.web_products (pos_product_id, status, featured, safety_stock, description) VALUES ($1, $2, $3, $4, $5)', [i.id, i.status ?? 'published', i.featured ?? false, i.safety ?? 0, `About ${i.name}`]);
  if (i.onHand !== null) await c.owner.query('INSERT INTO commerce.inventory_positions (pos_product_id, on_hand, reserved) VALUES ($1, $2, $3)', [i.id, i.onHand ?? 20_000, i.reserved ?? 0]);
  if (i.barcode) await c.owner.query('INSERT INTO commerce.catalog_barcodes (barcode, pos_product_id) VALUES ($1, $2)', [i.barcode, i.id]);
  if (i.image) await c.owner.query('INSERT INTO commerce.product_images (pos_product_id, object_key, width, height, size_bytes, is_primary) VALUES ($1, $2, 200, 200, 100, true)', [i.id, i.image]);
}
const heartbeat = (sql: string) => c.owner.query(`UPDATE commerce.devices SET last_seen_at = ${sql}`);

beforeAll(async () => {
  c = await makeCloud();
  await c.owner.query("INSERT INTO commerce.catalog_categories (pos_category_id, name_en, name_ar) VALUES (1, 'Fruits', ''), (2, 'Dairy', ''), (3, 'Empty aisle', ''), (4, 'Hidden aisle', '')");
  await c.owner.query('INSERT INTO commerce.web_categories (pos_category_id, sort, visible) VALUES (1, 2, true), (2, 1, true), (3, 3, true), (4, 4, false)');
  await add({ id: 1, name: 'Red apples', cat: 1, mode: 'weight', price: 899, barcode: '6290000000017', image: 'demo/apple.svg', featured: true });
  await add({ id: 2, name: 'Bananas', cat: 1, price: 500, onHand: 3000 });
  await add({ id: 3, name: 'Fresh milk', cat: 2, price: 650, onHand: 0 });
  await add({ id: 4, name: 'Secret draft', cat: 1, status: 'unpublished' });
  await add({ id: 5, name: 'Old archived item', cat: 1, status: 'archived' });
  await add({ id: 6, name: 'Stopped at till', cat: 1, active: false });
  await add({ id: 7, name: 'Delivery charge item', cat: 1, kind: 'service' });
  await add({ id: 8, name: 'Hidden aisle yoghurt', cat: 4 });
  await add({ id: 9, name: 'Never counted', cat: 2, onHand: null });
  await add({ id: 10, name: '100% juice_box', cat: 2, onHand: 10_000, reserved: 4000, safety: 2000, price: 6000 });
  await add({ id: 11, name: 'Oversold', cat: 2, onHand: -2000 });
  await c.owner.query("INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Made up till', 'h', now())");
  await c.owner.query('UPDATE commerce.store_settings SET delivery_fee_incl = 1500');
});

const names = (r: { items: { name: string }[] }) => r.items.map((p) => p.name);

describe('unit words', () => {
  it('turns POS unit codes into words', async () => {
    const { unitLabel } = await import('../src/server/catalog-core.ts');
    expect([unitLabel('PCS'), unitLabel('KG'), unitLabel('kg'), unitLabel('piece'), unitLabel('BOX')]).toEqual(['piece', 'kg', 'kg', 'piece', 'box']);
  });
});

describe('availability', () => {
  it('turns numbers into plain states', () => {
    expect(availabilityOf(20_000, true)).toEqual({ state: 'in_stock', available: 20_000 });
    expect(availabilityOf(3000, true)).toEqual({ state: 'low', available: 3000 });
    expect(availabilityOf(0, true)).toEqual({ state: 'out', available: 0 });
  });

  it('never claims stock when the POS has gone quiet', () => {
    expect(availabilityOf(20_000, false)).toEqual({ state: 'unknown', available: null });
  });

  it('treats a product the POS never reported as unknown, not as zero', () => {
    expect(availabilityOf(null, true)).toEqual({ state: 'unknown', available: null });
  });

  it('is on hand minus reserved minus safety stock', async () => {
    expect((await getProduct(c.app, 10))!.availability.available).toBe(4000);
  });

  it('never shows a negative number', async () => {
    expect((await getProduct(c.app, 11))!.availability).toEqual({ state: 'out', available: 0 });
  });

  it('knows when stock is out of date, and when no POS ever connected', async () => {
    expect(await stockIsFresh(c.app)).toBe(true);
    await heartbeat("now() - interval '16 minutes'");
    expect(await stockIsFresh(c.app)).toBe(false);
    await heartbeat('NULL');
    expect(await stockIsFresh(c.app)).toBe(false);
    await heartbeat('now()');
  });
});

describe('what customers can see', () => {
  it('shows only published, active, physical products', async () => {
    const shown = names(await listProducts(c.app, { limit: 50 }));
    for (const hidden of ['Secret draft', 'Old archived item', 'Stopped at till', 'Delivery charge item']) expect(shown).not.toContain(hidden);
    expect(shown).toContain('Red apples');
  });

  it('a product page for unpublished or archived items does not exist', async () => {
    expect(await getProduct(c.app, 4)).toBeNull();
    expect(await getProduct(c.app, 5)).toBeNull();
    expect(await getProduct(c.app, 999)).toBeNull();
  });

  it('never sends cost, safety stock or raw stock figures', async () => {
    const p = await getProduct(c.app, 1);
    expect(Object.keys(p!).sort()).toEqual(['availability', 'categoryId', 'categoryName', 'description', 'featured', 'id', 'imageUrl', 'name', 'priceIncl', 'sellMode', 'sku', 'unit']);
    expect(Object.keys(p!.availability).sort()).toEqual(['available', 'state']);
  });

  it('lists visible categories that have products, in the set order', async () => {
    expect((await listCategories(c.app)).map((x) => x.name)).toEqual(['Dairy', 'Fruits']);
  });

  it('counts products for a category', async () => {
    expect((await listCategories(c.app)).find((x) => x.name === 'Fruits')!.productCount).toBe(2);
  });

  it('builds a picture address from the stored key', async () => {
    expect((await getProduct(c.app, 1))!.imageUrl).toBe('/demo/apple.svg');
    expect((await getProduct(c.app, 2))!.imageUrl).toBeNull();
  });
});

describe('browsing', () => {
  it('filters by category', async () => {
    expect(names(await listProducts(c.app, { categoryId: 1, limit: 50 })).sort()).toEqual(['Bananas', 'Red apples']);
  });

  it('sorts by price both ways', async () => {
    expect(names(await listProducts(c.app, { categoryId: 1, sort: 'price_asc', limit: 50 }))).toEqual(['Bananas', 'Red apples']);
    expect(names(await listProducts(c.app, { categoryId: 1, sort: 'price_desc', limit: 50 }))).toEqual(['Red apples', 'Bananas']);
  });

  it('can hide what is out of stock', async () => {
    const shown = names(await listProducts(c.app, { categoryId: 2, inStockOnly: true, limit: 50 }));
    expect(shown).toContain('100% juice_box');
    expect(shown).not.toContain('Fresh milk');
    expect(shown).not.toContain('Oversold');
  });

  it('does not hide anything as out of stock when the numbers are out of date', async () => {
    await heartbeat("now() - interval '1 hour'");
    expect(names(await listProducts(c.app, { categoryId: 2, inStockOnly: true, limit: 50 }))).toContain('Fresh milk');
    await heartbeat('now()');
  });

  it('pages through results and gives the total', async () => {
    const a = await listProducts(c.app, { limit: 2, sort: 'name' });
    const b = await listProducts(c.app, { limit: 2, offset: 2, sort: 'name' });
    expect(a.total).toBe(b.total);
    expect(a.items).toHaveLength(2);
    expect(names(a).some((n) => names(b).includes(n))).toBe(false);
  });

  it('featured products can be asked for', async () => {
    expect(names(await listProducts(c.app, { featuredOnly: true, limit: 10 }))).toEqual(['Red apples']);
  });
});

describe('search', () => {
  it('finds by name, SKU, barcode and category', async () => {
    expect(names(await listProducts(c.app, { q: 'appl', limit: 10 }))).toEqual(['Red apples']);
    expect(names(await listProducts(c.app, { q: 'sku-2', limit: 10 }))).toEqual(['Bananas']);
    expect(names(await listProducts(c.app, { q: '6290000000017', limit: 10 }))).toEqual(['Red apples']);
    expect(names(await listProducts(c.app, { q: 'fruits', limit: 10 })).sort()).toEqual(['Bananas', 'Red apples']);
  });

  it('treats % and _ as ordinary characters', async () => {
    expect(names(await listProducts(c.app, { q: '100%', limit: 10 }))).toEqual(['100% juice_box']);
    expect(names(await listProducts(c.app, { q: 'e_b', limit: 10 }))).toEqual(['100% juice_box']);
    expect(names(await listProducts(c.app, { q: '%%%', limit: 10 }))).toEqual([]);
  });

  it('suggestions need two letters and stay short', async () => {
    expect(await suggest(c.app, 'a')).toEqual([]);
    const s = await suggest(c.app, 'an');
    expect(s.map((x) => x.name)).toContain('Bananas');
    expect(s.length).toBeLessThanOrEqual(6);
  });

  it('cannot find hidden products', async () => {
    expect(names(await listProducts(c.app, { q: 'secret', limit: 10 }))).toEqual([]);
  });
});

describe('cart quote', () => {
  const q = (lines: { productId: number; qty: number }[], fulfilment: 'delivery' | 'pickup' = 'pickup', areaId?: string) => quoteCart(c.app, { lines, fulfilment, areaId });

  it('takes the price from the server', async () => {
    const r = await q([{ productId: 2, qty: 2000 }]);
    expect(r).toMatchObject({ itemsIncl: 1000, totalIncl: 1000, deliveryFeeIncl: 0, canCheckout: true });
    expect(r.lines[0]).toMatchObject({ name: 'Bananas', unitPriceIncl: 500, lineIncl: 1000, issue: null });
  });

  it('refuses a request that tries to set a price', () => {
    expect(cartBody.safeParse({ fulfilment: 'pickup', lines: [{ productId: 2, qty: 1000, priceIncl: 1 }] }).success).toBe(false);
    expect(cartBody.safeParse({ fulfilment: 'pickup', total: 1, lines: [{ productId: 2, qty: 1000 }] }).success).toBe(false);
  });

  it('flags items that left the shop and leaves them out of the total', async () => {
    const r = await q([{ productId: 2, qty: 1000 }, { productId: 4, qty: 1000 }, { productId: 999, qty: 1000 }]);
    expect(r.lines.map((l) => l.issue)).toEqual([null, 'unavailable', 'unavailable']);
    expect(r.totalIncl).toBe(500);
    expect(r.canCheckout).toBe(false);
  });

  it('flags asking for more than is available', async () => {
    const r = await q([{ productId: 2, qty: 4000 }]);
    expect(r.lines[0]).toMatchObject({ issue: 'short', availability: { available: 3000 } });
    expect(r.canCheckout).toBe(false);
  });

  it('flags items with none left', async () => {
    expect((await q([{ productId: 3, qty: 1000 }])).lines[0]!.issue).toBe('unavailable');
  });

  it('refuses half units of a whole-unit product', async () => {
    await expect(q([{ productId: 2, qty: 1500 }])).rejects.toThrow(ApiError);
  });

  it('allows part of a kilo on a weighed product and marks it an estimate', async () => {
    expect((await q([{ productId: 1, qty: 500 }])).lines[0]).toMatchObject({ lineIncl: 450, isEstimate: true });
  });

  it('runs the free delivery rule on the server', async () => {
    const over = await q([{ productId: 10, qty: 1000 }], 'delivery');
    expect(over).toMatchObject({ freeDelivery: true, deliveryFeeIncl: 0, standardFeeIncl: 1500, eligibleSubtotal: 5217, remainingForFree: 0 });
  });

  it('charges delivery below the threshold and says what is left', async () => {
    const r = await q([{ productId: 2, qty: 1000 }], 'delivery');
    expect(r).toMatchObject({ freeDelivery: false, deliveryFeeIncl: 1500, eligibleSubtotal: 435, remainingForFree: 4566 });
  });

  it('uses the fee of the chosen area', async () => {
    const [a] = await c.owner.query<{ id: string }>("INSERT INTO commerce.delivery_areas (name, fee_incl) VALUES ('Made up area', 700) RETURNING id");
    expect((await q([{ productId: 2, qty: 1000 }], 'delivery', a!.id)).deliveryFeeIncl).toBe(700);
  });

  it('refuses an area that is not offered', async () => {
    await expect(q([{ productId: 2, qty: 1000 }], 'delivery', '11111111-1111-4111-8111-111111111111')).rejects.toThrow(ApiError);
  });

  it('says delivery is unavailable when no fee was set, instead of making one up', async () => {
    await c.owner.query('UPDATE commerce.store_settings SET delivery_fee_incl = NULL');
    const r = await q([{ productId: 2, qty: 1000 }], 'delivery');
    expect(r).toMatchObject({ deliveryUnavailable: true, deliveryFeeIncl: 0, canCheckout: false });
    await c.owner.query('UPDATE commerce.store_settings SET delivery_fee_incl = 1500');
  });

  it('closes checkout when the numbers are out of date, but keeps the cart', async () => {
    await heartbeat("now() - interval '1 hour'");
    const r = await q([{ productId: 3, qty: 1000 }]);
    expect(r).toMatchObject({ stockFresh: false, canCheckout: false });
    expect(r.lines[0]).toMatchObject({ issue: null, availability: { state: 'unknown' } });
    await heartbeat('now()');
  });

  it('an empty cart cannot check out', async () => {
    expect(await q([])).toMatchObject({ totalIncl: 0, canCheckout: false });
  });
});
