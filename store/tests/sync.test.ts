import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEvents } from '../src/server/device-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { getProduct, listCategories } from '../src/server/catalog-core.ts';
import { eventBatch, type SyncEvent } from '../src/shared/commerce-events.ts';
import { makeCloud, type TestCloud } from './helpers.ts';

let c: TestCloud;
let deviceId: string;
let seq: number;

const at = '2026-11-10T09:30:00.000Z';
const ev = (type: string, payload: object, n = ++seq): SyncEvent => eventBatch.parse({ events: [{ eventId: `${deviceId}:0:${n}`, version: 1, occurredAt: at, type, payload }] }).events[0]!;
const product = (id: number, more: object = {}) => ev('catalog.product', { productId: id, sku: `SKU-${id}`, nameEn: `Made up ${id}`, nameAr: '', categoryId: null, unit: 'piece', sellMode: 'unit', itemKind: 'stock', priceIncl: 1150, vatRateBp: 1500, active: true, barcodes: [], ...more });
let movementId = 0;
const move = (id: number, qty: number, reason = 'grn', orderId: string | null = null) => ev('stock.movement', { movementId: ++movementId, productId: id, qty, reason, sourceType: reason, sourceId: movementId, sourceLine: 0, orderId });
const checkpoint = (balances: { productId: number; qty: number }[]) => ev('stock.checkpoint', { uptoSeq: seq, part: 1, parts: 1, balances });
const send = (events: SyncEvent[]) => applyEvents(c.device, { deviceId }, events);
const stock = async (id: number) => (await c.owner.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM commerce.inventory_positions WHERE pos_product_id = $1', [id]))[0];
const count = async (sql: string) => Number((await c.owner.query<{ n: string | number }>(`SELECT count(*) AS n FROM commerce.${sql}`))[0]!.n);

beforeEach(async () => {
  c = await makeCloud();
  seq = 0;
  movementId = 0;
  [{ id: deviceId }] = (await c.owner.query<{ id: string }>("INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Made up till', 'h', now()) RETURNING id")) as [{ id: string }];
});

afterEach(() => c.pg.close());

async function order(): Promise<string> {
  const [o] = await c.owner.query<{ id: string }>(`INSERT INTO commerce.orders (public_ref, access_token_hash, idempotency_key, fulfilment, customer_name, phone, items_incl, eligible_subtotal, total_incl, total_vat) VALUES (gen_random_uuid()::text, 'h', gen_random_uuid()::text, 'pickup', 'Made Up', '0500000000', 100, 87, 100, 13) RETURNING id`);
  return o!.id;
}
const reserve = (id: string, lines: { productId: number; qty: number }[], db = c.app) => db.query("SELECT commerce.place_order_reserve($1, $2::jsonb, now() + interval '30 minutes')", [id, JSON.stringify(lines)]);
const release = (id: string, why = 'rejected') => c.app.query<{ n: number }>('SELECT commerce.release_reservation($1, $2) AS n', [id, why]);

describe('catalogue events', () => {
  it('creates a product as unpublished, so nothing appears online by accident', async () => {
    await send([product(1)]);
    expect(await getProduct(c.app, 1)).toBeNull();
    const [w] = await c.owner.query<{ status: string }>('SELECT status FROM commerce.web_products WHERE pos_product_id = 1');
    expect(w!.status).toBe('unpublished');
  });

  it('a later change updates POS fields and keeps web fields', async () => {
    await send([product(1)]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published', description = 'Kept' WHERE pos_product_id = 1");
    await send([product(1, { priceIncl: 2000, nameEn: 'New name' })]);
    expect(await getProduct(c.app, 1)).toMatchObject({ priceIncl: 2000, name: 'New name', description: 'Kept' });
  });

  it('replaces barcodes, and a barcode can move to another product', async () => {
    await send([product(1, { barcodes: ['111', '222'] }), product(2)]);
    await send([product(1, { barcodes: ['222'] }), product(2, { barcodes: ['333', '111'] })]);
    const rows = await c.owner.query<{ barcode: string; pos_product_id: number }>('SELECT barcode, pos_product_id FROM commerce.catalog_barcodes ORDER BY barcode');
    expect(rows.map((r) => [r.barcode, Number(r.pos_product_id)])).toEqual([['111', 2], ['222', 1], ['333', 2]]);
  });

  it('creates categories, and a product can arrive before its category', async () => {
    await send([product(1, { categoryId: 7 })]);
    await send([ev('catalog.category', { categoryId: 7, nameEn: 'Fruits', nameAr: '' }), product(1, { categoryId: 7 })]);
    const [p] = await c.owner.query<{ category_id: number }>('SELECT category_id FROM commerce.catalog_products WHERE pos_product_id = 1');
    expect(Number(p!.category_id)).toBe(7);
    expect((await c.owner.query('SELECT 1 FROM commerce.web_categories WHERE pos_category_id = 7')).length).toBe(1);
  });

  it('a product stopped at the POS leaves the shop', async () => {
    await send([product(1)]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published' WHERE pos_product_id = 1");
    await send([product(1, { active: false })]);
    expect(await getProduct(c.app, 1)).toBeNull();
  });

  it('category tiles appear once a product is published', async () => {
    await send([ev('catalog.category', { categoryId: 7, nameEn: 'Fruits', nameAr: '' }), product(1, { categoryId: 7 })]);
    expect(await listCategories(c.app)).toEqual([]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
    expect((await listCategories(c.app)).map((x) => x.name)).toEqual(['Fruits']);
  });
});

describe('stock events', () => {
  it('adds every kind of movement', async () => {
    await send([product(1), move(1, 10_000, 'grn'), move(1, -2000, 'sale'), move(1, 1000, 'refund'), move(1, -500, 'waste'), move(1, -500, 'count_adj')]);
    expect(await stock(1)).toMatchObject({ on_hand: 8000, reserved: 0 });
  });

  it('a repeated event does nothing', async () => {
    const batch = [product(1), move(1, 5000)];
    await send(batch);
    expect(await send(batch)).toMatchObject({ ackedSeq: 2 });
    expect(await stock(1)).toMatchObject({ on_hand: 5000 });
    expect(await count('sync_inbox')).toBe(2);
  });

  it('events in the wrong order wait for the gap, then all apply once', async () => {
    const p = product(1);
    const a = move(1, 1000);
    const b = move(1, 2000);
    const d = move(1, 4000);
    await send([p]);
    expect(await send([d])).toMatchObject({ ackedSeq: 1 });
    expect(await stock(1)).toBeUndefined();
    expect(await send([d, b, a])).toMatchObject({ ackedSeq: 4 });
    expect(await stock(1)).toMatchObject({ on_hand: 7000 });
  });

  it('a batch can be overlapping with what was already applied', async () => {
    const p = product(1);
    const a = move(1, 1000);
    await send([p, a]);
    const b = move(1, 2000);
    expect(await send([a, b])).toMatchObject({ ackedSeq: 3 });
    expect(await stock(1)).toMatchObject({ on_hand: 3000 });
  });

  it('an empty batch is a heartbeat and answers with the position', async () => {
    await send([product(1)]);
    expect(await send([])).toMatchObject({ ackedSeq: 1 });
  });

  it('a movement for an unknown product is parked and does not block the queue', async () => {
    expect(await send([move(99, 1000), product(1), move(1, 500)])).toMatchObject({ ackedSeq: 3 });
    expect(await stock(1)).toMatchObject({ on_hand: 500 });
    const [p] = await c.owner.query<{ status: string; error: string }>("SELECT status, error FROM commerce.sync_inbox WHERE status = 'parked'");
    expect(p).toMatchObject({ status: 'parked', error: 'unknown product' });
  });

  it('a newer event version is parked, not applied', async () => {
    await send([product(1)]);
    const newer = { ...move(1, 5000), version: 2 };
    expect(await send([newer])).toMatchObject({ ackedSeq: 2 });
    expect(await stock(1)).toBeUndefined();
    expect(await count("sync_inbox WHERE status = 'parked'")).toBe(1);
  });

  it('refuses events from another device id', async () => {
    const bad = { ...move(1, 1000), eventId: `22222222-2222-4222-8222-222222222222:0:1` };
    await expect(send([bad])).rejects.toThrow(ApiError);
    expect(await count('sync_inbox')).toBe(0);
  });

  it('one failing batch changes nothing at all', async () => {
    const good = product(1);
    const bad = { ...move(1, 1000), eventId: `22222222-2222-4222-8222-222222222222:0:2` };
    await expect(send([good, bad])).rejects.toThrow(ApiError);
    expect(await count('catalog_products')).toBe(0);
  });
});

describe('checkpoints', () => {
  it('sets stock on the first load, with no discrepancy', async () => {
    await send([product(1), product(2), checkpoint([{ productId: 1, qty: 5000 }, { productId: 2, qty: 0 }])]);
    expect(await stock(1)).toMatchObject({ on_hand: 5000 });
    expect(await count('stock_discrepancies')).toBe(0);
  });

  it('a matching check changes nothing', async () => {
    await send([product(1), move(1, 5000), checkpoint([{ productId: 1, qty: 5000 }])]);
    expect(await count('stock_discrepancies')).toBe(0);
  });

  it('a different number: the POS wins and it is recorded', async () => {
    await send([product(1), move(1, 5000), checkpoint([{ productId: 1, qty: 4000 }])]);
    expect(await stock(1)).toMatchObject({ on_hand: 4000 });
    const [d] = await c.owner.query<{ kind: string; expected: number; actual: number; state: string }>('SELECT kind, expected, actual, state FROM commerce.stock_discrepancies');
    expect(d).toEqual({ kind: 'checkpoint', expected: 5000, actual: 4000, state: 'open' });
  });

  it('keeps reservations through a correction', async () => {
    await send([product(1), move(1, 5000)]);
    await reserve(await order(), [{ productId: 1, qty: 3000 }]);
    await send([checkpoint([{ productId: 1, qty: 4000 }])]);
    expect(await stock(1)).toEqual(expect.objectContaining({ on_hand: 4000, reserved: 3000 }));
  });
});

describe('reservations', () => {
  beforeEach(async () => {
    await send([product(1), product(2), move(1, 5000), move(2, 5000)]);
  });

  it('holds stock and lowers what is available', async () => {
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
    await reserve(await order(), [{ productId: 1, qty: 3000 }]);
    expect(await stock(1)).toMatchObject({ on_hand: 5000, reserved: 3000 });
    expect((await getProduct(c.app, 1))!.availability.available).toBe(2000);
  });

  it('the prompt case: 5 units, web reserves 3, POS sells 2', async () => {
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
    await reserve(await order(), [{ productId: 1, qty: 3000 }]);
    await send([move(1, -2000, 'sale')]);
    expect(await stock(1)).toMatchObject({ on_hand: 3000, reserved: 3000 });
    expect((await getProduct(c.app, 1))!.availability).toEqual({ state: 'out', available: 0 });
  });

  it('refuses more than is free, naming the product, and changes nothing', async () => {
    await expect(reserve(await order(), [{ productId: 2, qty: 1000 }, { productId: 1, qty: 6000 }])).rejects.toThrow('INSUFFICIENT_STOCK:1');
    expect(await stock(2)).toMatchObject({ reserved: 0 });
    expect(await count('reservations')).toBe(0);
  });

  it('counts safety stock as not for sale online', async () => {
    await c.owner.query('UPDATE commerce.web_products SET safety_stock = 2000 WHERE pos_product_id = 1');
    await expect(reserve(await order(), [{ productId: 1, qty: 4000 }])).rejects.toThrow('INSUFFICIENT_STOCK');
    await expect(reserve(await order(), [{ productId: 1, qty: 3000 }])).resolves.toBeDefined();
  });

  it('refuses a product the POS never reported', async () => {
    await send([product(3)]);
    await expect(reserve(await order(), [{ productId: 3, qty: 1000 }])).rejects.toThrow('INSUFFICIENT_STOCK:3');
  });

  it('reserving twice for the same order holds it once', async () => {
    const id = await order();
    await reserve(id, [{ productId: 1, qty: 1000 }]);
    await reserve(id, [{ productId: 1, qty: 1000 }]);
    expect(await stock(1)).toMatchObject({ reserved: 1000 });
  });

  it('release gives stock back once', async () => {
    const id = await order();
    await reserve(id, [{ productId: 1, qty: 3000 }]);
    expect(Number((await release(id))[0]!.n)).toBe(1);
    expect(Number((await release(id))[0]!.n)).toBe(0);
    expect(await stock(1)).toMatchObject({ on_hand: 5000, reserved: 0 });
    const [r] = await c.owner.query<{ state: string; release_reason: string }>('SELECT state, release_reason FROM commerce.reservations');
    expect(r).toEqual({ state: 'released', release_reason: 'rejected' });
  });

  it('a linked POS sale uses the reservation without counting twice', async () => {
    const id = await order();
    await reserve(id, [{ productId: 1, qty: 3000 }]);
    await send([move(1, -3000, 'sale', id)]);
    expect(await stock(1)).toMatchObject({ on_hand: 2000, reserved: 0 });
    const [r] = await c.owner.query<{ state: string }>('SELECT state FROM commerce.reservations');
    expect(r!.state).toBe('consumed');
  });

  it('a weighed line can use a different amount than was held', async () => {
    const id = await order();
    await reserve(id, [{ productId: 1, qty: 1000 }]);
    await send([move(1, -1100, 'sale', id)]);
    expect(await stock(1)).toMatchObject({ on_hand: 3900, reserved: 0 });
  });

  it('a consumed reservation cannot be released', async () => {
    const id = await order();
    await reserve(id, [{ productId: 1, qty: 3000 }]);
    await send([move(1, -3000, 'sale', id)]);
    expect(Number((await release(id))[0]!.n)).toBe(0);
    expect(await stock(1)).toMatchObject({ reserved: 0, on_hand: 2000 });
  });

  it('the web role can only change stock through these functions', async () => {
    await expect(c.app.query('UPDATE commerce.inventory_positions SET reserved = 0')).rejects.toThrow(/permission denied/);
    await expect(c.app.query("SELECT commerce.apply_events(gen_random_uuid(), '[]'::jsonb)")).rejects.toThrow(/permission denied/);
  });

  it('the device role cannot reserve, or write stock directly', async () => {
    await expect(c.device.query('UPDATE commerce.inventory_positions SET on_hand = 1')).rejects.toThrow(/permission denied/);
    await expect(reserve(await order(), [{ productId: 1, qty: 1 }], c.device)).rejects.toThrow(/permission denied/);
  });
});
