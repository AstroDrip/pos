import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/server/errors.ts';
import { cancelByCustomer, expireDueOrders, getOrderForCustomer, normalisePhone, placeOrder, type PlaceOrderInput } from '../src/server/order-core.ts';
import { makeCloud, type TestCloud } from './helpers.ts';

let c: TestCloud;
const token = () => randomBytes(32).toString('base64url');
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));
const IP = '203.0.113.9';

async function addProduct(id: number, onHand: number, price = 1150, mode: 'unit' | 'weight' = 'unit') {
  await c.owner.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, $3, '', $4, $5, $6, 1500, true)`, [id, `SKU-${id}`, `Made up ${id}`, mode === 'weight' ? 'KG' : 'PCS', mode, price]);
  await c.owner.query("INSERT INTO commerce.web_products (pos_product_id, status) VALUES ($1, 'published')", [id]);
  await c.owner.query('INSERT INTO commerce.inventory_positions (pos_product_id, on_hand) VALUES ($1, $2)', [id, onHand]);
}

let areaId: string;
beforeEach(async () => {
  c = await makeCloud();
  await c.owner.query("INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Made up till', 'h', now())");
  await c.owner.query("UPDATE commerce.store_settings SET delivery_fee_incl = 1500, payment_methods = ARRAY['pay_at_pickup', 'card']");
  [{ id: areaId }] = (await c.owner.query<{ id: string }>("INSERT INTO commerce.delivery_areas (name) VALUES ('Made up area') RETURNING id")) as [{ id: string }];
  await addProduct(1, 5000);
  await addProduct(2, 10_000, 899, 'weight');
});
afterEach(() => c.pg.close());

const pickup = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  idempotencyKey: `key-${randomBytes(6).toString('hex')}`,
  accessToken: token(),
  fulfilment: 'pickup',
  customerName: 'Made Up Shopper',
  phone: '0512345678',
  paymentMethod: 'pay_at_pickup',
  lines: [{ productId: 1, qty: 2000 }],
  expectedTotal: 2300,
  ...over,
});
const place = (input: PlaceOrderInput, ip = IP) => placeOrder(c.app, input, ip);
const stock = async (id: number) => (await c.owner.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM commerce.inventory_positions WHERE pos_product_id = $1', [id]))[0]!;
const count = async (t: string) => Number((await c.owner.query<{ n: string | number }>(`SELECT count(*) AS n FROM commerce.${t}`))[0]!.n);

describe('phone numbers', () => {
  it('accepts Saudi mobile numbers in the usual forms', () => {
    for (const p of ['0512345678', '512345678', '+966512345678', '966512345678', '00966512345678', '051 234 5678']) expect(normalisePhone(p)).toBe('+966512345678');
  });

  it('refuses anything else', () => {
    for (const p of ['12345', '0412345678', '+9665123', 'abc', '05123456789']) expect(normalisePhone(p)).toBeNull();
  });
});

describe('placing an order', () => {
  it('creates one waiting order, holds the stock and copies the server prices', async () => {
    const r = await place(pickup());
    expect(r.publicRef).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const [o] = await c.owner.query<Record<string, unknown>>('SELECT status, fulfilment, phone, total_incl, total_vat, items_incl, delivery_fee_incl FROM commerce.orders');
    expect(o).toEqual({ status: 'placed', fulfilment: 'pickup', phone: '+966512345678', total_incl: 2300, total_vat: 300, items_incl: 2300, delivery_fee_incl: 0 });
    const [l] = await c.owner.query<Record<string, unknown>>('SELECT sku, name, qty, unit_price_incl, line_incl, line_vat, is_estimate FROM commerce.order_lines');
    expect(l).toEqual({ sku: 'SKU-1', name: 'Made up 1', qty: 2000, unit_price_incl: 1150, line_incl: 2300, line_vat: 300, is_estimate: false });
    expect(await stock(1)).toEqual({ on_hand: 5000, reserved: 2000 });
    const [p] = await c.owner.query<Record<string, unknown>>('SELECT method, status, amount FROM commerce.payments');
    expect(p).toEqual({ method: 'pay_at_pickup', status: 'due_at_pickup', amount: 2300 });
    const [h] = await c.owner.query<Record<string, unknown>>('SELECT from_status, to_status, actor FROM commerce.order_status_history');
    expect(h).toEqual({ from_status: null, to_status: 'placed', actor: 'customer' });
  });

  it('stores only a hash of the private link', async () => {
    const input = pickup();
    await place(input);
    const [o] = await c.owner.query<{ access_token_hash: string }>('SELECT access_token_hash FROM commerce.orders');
    expect(o!.access_token_hash).toBe(createHash('sha256').update(input.accessToken).digest('hex'));
  });

  it('a retry with the same key gives the same order and holds stock once', async () => {
    const input = pickup();
    const a = await place(input);
    const b = await place(input);
    expect(b.publicRef).toBe(a.publicRef);
    expect(await count('orders')).toBe(1);
    expect(await stock(1)).toMatchObject({ reserved: 2000 });
  });

  it('the same key with a different order is refused', async () => {
    const input = pickup();
    await place(input);
    expect(await code(place({ ...input, lines: [{ productId: 1, qty: 1000 }], expectedTotal: 1150 }))).toBe('409 KEY_REUSED');
  });

  it('refuses when the price changed since the shopper looked, and makes nothing', async () => {
    expect(await code(place(pickup({ expectedTotal: 2000 })))).toBe('409 PRICE_CHANGED');
    expect(await count('orders')).toBe(0);
  });

  it('refuses when stock ran out, naming nothing secret, and makes nothing', async () => {
    const e = await place(pickup({ lines: [{ productId: 1, qty: 6000 }], expectedTotal: 6900 })).catch((x: ApiError) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('OUT_OF_STOCK');
    expect(await count('orders')).toBe(0);
    expect(await stock(1)).toMatchObject({ reserved: 0 });
  });

  it('two shoppers for the last units: the second is told, the first keeps them', async () => {
    await place(pickup({ lines: [{ productId: 1, qty: 4000 }], expectedTotal: 4600, phone: '0511111111' }));
    expect(await code(place(pickup({ lines: [{ productId: 1, qty: 2000 }], phone: '0522222222' })))).toBe('409 OUT_OF_STOCK');
    expect(await stock(1)).toMatchObject({ reserved: 4000 });
  });

  it('pay at pickup only works for pickup', async () => {
    expect(await code(place(pickup({ fulfilment: 'delivery', areaId, addressLine: 'Made up street 1', expectedTotal: 3800 })))).toBe('400 PAYMENT_METHOD');
  });

  it('a method the store has not switched on is refused', async () => {
    await c.owner.query("UPDATE commerce.store_settings SET payment_methods = ARRAY['card']");
    expect(await code(place(pickup()))).toBe('400 PAYMENT_METHOD');
  });

  it('online payment is not built yet, so it cannot be chosen', async () => {
    expect(await code(place(pickup({ paymentMethod: 'card' })))).toBe('400 PAYMENT_METHOD');
  });

  it('delivery needs an area and an address', async () => {
    expect(await code(place(pickup({ fulfilment: 'delivery', paymentMethod: 'card', expectedTotal: 3800 })))).toBe('400 INVALID');
  });

  it('pickup cannot carry an address', async () => {
    expect(await code(place(pickup({ addressLine: 'Made up street 1' })))).toBe('400 INVALID');
  });

  it('refuses a bad phone number or empty name', async () => {
    expect(await code(place(pickup({ phone: '12' })))).toBe('400 INVALID');
    expect(await code(place(pickup({ customerName: '  ' })))).toBe('400 INVALID');
  });

  it('refuses a weak private link', async () => {
    expect(await code(place(pickup({ accessToken: 'short' })))).toBe('400 INVALID');
  });

  it('refuses an empty cart', async () => {
    expect(await code(place(pickup({ lines: [], expectedTotal: 0 })))).toBe('400 INVALID');
  });

  it('refuses while the POS has gone quiet', async () => {
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '1 hour'");
    expect(await code(place(pickup()))).toBe('409 CHECKOUT_CLOSED');
  });

  it('weighed items are marked as estimates', async () => {
    await place(pickup({ lines: [{ productId: 2, qty: 1500 }], expectedTotal: 1349 }));
    const [l] = await c.owner.query<{ is_estimate: boolean }>('SELECT is_estimate FROM commerce.order_lines');
    expect(l!.is_estimate).toBe(true);
  });

  it('limits open orders per phone', async () => {
    for (let i = 0; i < 3; i++) await place(pickup({ lines: [{ productId: 1, qty: 1000 }], expectedTotal: 1150 }));
    expect(await code(place(pickup({ lines: [{ productId: 1, qty: 1000 }], expectedTotal: 1150 })))).toBe('429 TOO_MANY_OPEN_ORDERS');
  });

  it('limits orders from one address', async () => {
    await addProduct(9, 1_000_000);
    let last = '';
    for (let i = 0; i < 22; i++) last = await code(place(pickup({ phone: `05${String(10_000_000 + i)}`, lines: [{ productId: 9, qty: 1000 }], expectedTotal: 1150 }), '198.51.100.7'));
    expect(last).toBe('429 RATE_LIMITED');
  });
});

describe('tracking', () => {
  it('guessing links from one address is stopped, and the right link still works', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    for (let i = 0; i < 30; i++) expect(await getOrderForCustomer(c.app, publicRef, token(), '203.0.113.9')).toBeNull();
    await expect(getOrderForCustomer(c.app, publicRef, token(), '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    await expect(cancelByCustomer(c.app, publicRef, token(), '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect(await getOrderForCustomer(c.app, publicRef, token(), '198.51.100.7')).toBeNull();
    expect(await getOrderForCustomer(c.app, publicRef, input.accessToken, '203.0.113.9')).toMatchObject({ publicRef });
  });

  it('the right link shows the order', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    const o = await getOrderForCustomer(c.app, publicRef, input.accessToken, '192.0.2.1');
    expect(o).toMatchObject({ publicRef, status: 'placed', fulfilment: 'pickup', paymentMethod: 'pay_at_pickup', paymentStatus: 'due_at_pickup', totalIncl: 2300, canCancel: true });
    expect(o!.lines).toEqual([{ name: 'Made up 1', qty: 2000, unit: 'piece', sellMode: 'unit', unitPriceIncl: 1150, lineIncl: 2300, isEstimate: false }]);
    expect(o!.history.map((h) => h.status)).toEqual(['placed']);
  });

  it('a wrong link and an unknown order look the same', async () => {
    const { publicRef } = await place(pickup());
    expect(await getOrderForCustomer(c.app, publicRef, token(), '192.0.2.1')).toBeNull();
    expect(await getOrderForCustomer(c.app, 'AAAA-AAAA', token(), '192.0.2.1')).toBeNull();
  });

  it('shows no staff names, internal ids or other orders', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    const text = JSON.stringify(await getOrderForCustomer(c.app, publicRef, input.accessToken, '192.0.2.1'));
    expect(text).not.toMatch(/staff|access_token|idempotency|"id"|cost/);
  });
});

describe('customer cancelling', () => {
  it('before acceptance: cancelled, stock and payment released', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    await cancelByCustomer(c.app, publicRef, input.accessToken, '192.0.2.1');
    expect(await stock(1)).toMatchObject({ reserved: 0 });
    const o = await getOrderForCustomer(c.app, publicRef, input.accessToken, '192.0.2.1');
    expect(o).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled', canCancel: false });
    expect(o!.history.map((h) => h.status)).toEqual(['placed', 'cancelled']);
  });

  it('twice does nothing more', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    await cancelByCustomer(c.app, publicRef, input.accessToken, '192.0.2.1');
    expect(await code(cancelByCustomer(c.app, publicRef, input.accessToken, '192.0.2.1'))).toBe('409 CANNOT_CANCEL');
    expect(await count("order_status_history WHERE to_status = 'cancelled'")).toBe(1);
  });

  it('not once the store has accepted', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    await c.owner.query("UPDATE commerce.orders SET status = 'accepted'");
    expect(await code(cancelByCustomer(c.app, publicRef, input.accessToken, '192.0.2.1'))).toBe('409 CANNOT_CANCEL');
    expect(await stock(1)).toMatchObject({ reserved: 2000 });
  });

  it('needs the private link', async () => {
    const { publicRef } = await place(pickup());
    expect(await code(cancelByCustomer(c.app, publicRef, token(), '192.0.2.1'))).toBe('404 NOT_FOUND');
  });
});

describe('expiry', () => {
  it('an order not accepted in time expires and gives its stock back', async () => {
    const input = pickup();
    const { publicRef } = await place(input);
    await c.owner.query("UPDATE commerce.orders SET expires_at = now() - interval '1 minute'");
    expect(await expireDueOrders(c.app)).toBe(1);
    expect(await stock(1)).toMatchObject({ reserved: 0 });
    expect(await getOrderForCustomer(c.app, publicRef, input.accessToken, '192.0.2.1')).toMatchObject({ status: 'expired', paymentStatus: 'cancelled' });
    expect(await expireDueOrders(c.app)).toBe(0);
  });

  it('waits while the POS is quiet, so staff are not blamed for an outage', async () => {
    await place(pickup());
    await c.owner.query("UPDATE commerce.orders SET expires_at = now() - interval '1 minute'");
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '1 hour'");
    expect(await expireDueOrders(c.app)).toBe(0);
  });

  it('never touches an order the store already accepted', async () => {
    await place(pickup());
    await c.owner.query("UPDATE commerce.orders SET expires_at = now() - interval '1 minute', status = 'accepted'");
    expect(await expireDueOrders(c.app)).toBe(0);
    expect(await stock(1)).toMatchObject({ reserved: 2000 });
  });

  it('new orders get the acceptance window from settings', async () => {
    await place(pickup());
    const [o] = await c.owner.query<{ mins: number | string }>('SELECT round(extract(epoch FROM (expires_at - created_at)) / 60) AS mins FROM commerce.orders');
    expect(Number(o!.mins)).toBe(30);
  });
});
