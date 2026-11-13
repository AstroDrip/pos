import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createProductCategory, listProductCategories, productCategory, setPrice, setProductActive, setProductCategory } from './catalog';
import { commerceEnabled, commerceRetryDelayMs, commerceStatus, commerceTick, makeCommerceTransport, restartAfterRestore, startCommerce, stopCommerce, syncCommerceOnce, type CommerceEvent, type CommerceTransport } from './commerce-sync';
import type { Ctx } from './context';
import { applyMovement } from './inventory';
import { makeTestCtx, seedUsers } from './test-helpers';

const DEVICE = '11111111-1111-4111-8111-111111111111';
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;

/** Stands in for the web. Answers like the real one: acknowledges everything it was sent, in order. */
function fakeWeb() {
  const received: CommerceEvent[] = [];
  let acked = 0;
  const transport: CommerceTransport = {
    send: async (events) => {
      received.push(...events);
      if (events.length) acked = Number(events.at(-1)!.eventId.split(':')[2]);
      return { ackedSeq: acked };
    },
  };
  return { received, transport };
}

const product = (sku = 'A', extra: object = {}) => createProduct(ctx, u.admin, { sku, nameAr: 'تجربة', nameEn: `Made up ${sku}`, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1150, ...extra });
const move = (productId: number, qty: number, n: number) => ctx.db.transaction(() => applyMovement(ctx, { productId, qty, reason: qty > 0 ? 'grn' : 'waste', sourceType: 'test', sourceId: n, sourceLine: 0, userId: u.admin, unitCost: 500 }))();
const addBarcode = (productId: number, code: string) => ctx.db.prepare('INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)').run(code, productId);
const outbox = () => (ctx.db.prepare('SELECT count(*) AS n FROM commerce_outbox').get() as { n: number }).n;
const drain = async (web = fakeWeb()) => {
  for (let i = 0; i < 500; i++) if ((await syncCommerceOnce(ctx, web.transport, DEVICE)).sent === 0) break;
  return web;
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('when commerce is off', () => {
  it('is off on a new database', () => {
    expect(commerceEnabled(ctx)).toBe(false);
  });

  it('sends the device secret as a bearer token on each commerce event', async () => {
    let seen: RequestInit | undefined;
    const transport = makeCommerceTransport({ url: 'https://example.com', deviceId: DEVICE, secret: 'super-secret' }, async (_url, init) => {
      seen = init;
      return new Response(JSON.stringify({ ackedSeq: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await transport.send([{ eventId: `${DEVICE}:0:1`, version: 1, occurredAt: '2026-11-10T00:00:00Z', type: 'catalog.product', payload: { productId: 1 } }]);
    const auth = (seen?.headers as Record<string, string> | undefined)?.authorization;
    expect(auth).toMatch(/^Bearer /);
    expect(auth).toContain('super-secret');
  });

  it('nothing is written to the outbox, whatever happens in the POS', () => {
    const id = product();
    move(id, 5000, 1);
    setPrice(ctx, u.admin, id, 999);
    addBarcode(id, '6290000000017');
    createProductCategory(ctx, u.admin, 'Fruits');
    expect(outbox()).toBe(0);
  });
});

describe('starting', () => {
  it('needs permission to change settings', () => {
    expect(() => startCommerce(ctx, u.cashier)).toThrow();
    expect(commerceEnabled(ctx)).toBe(false);
  });

  it('sends every category, every product, then the stock of each', async () => {
    const cat = createProductCategory(ctx, u.admin, 'Fruits');
    const a = product('A', { categoryId: cat, barcodes: ['6290000000017'] });
    const b = product('B');
    move(a, 5000, 1);
    startCommerce(ctx, u.admin);
    const { received } = await drain();
    expect(received.map((e) => e.type)).toEqual(['catalog.category', 'catalog.product', 'catalog.product', 'stock.checkpoint']);
    expect(received[1]!.payload).toMatchObject({ productId: a, sku: 'A', nameEn: 'Made up A', categoryId: cat, unit: 'PCS', sellMode: 'unit', itemKind: 'stock', priceIncl: 1150, vatRateBp: 1500, active: true, barcodes: ['6290000000017'] });
    expect(received[3]!.payload).toMatchObject({ part: 1, parts: 1, balances: [{ productId: a, qty: 5000 }, { productId: b, qty: 0 }] });
  });

  it('splits a very large stock list', async () => {
    const insert = ctx.db.prepare("INSERT INTO products (sku, name_ar, name_en, unit_id, sell_mode, vat_rate_bp, price_incl, created_at, updated_at) VALUES (?, 'x', 'x', 1, 'unit', 1500, 1, 'n', 'n')");
    ctx.db.transaction(() => {
      for (let i = 0; i < 4100; i++) insert.run(`S${i}`);
    })();
    startCommerce(ctx, u.admin);
    const checkpoints = (await drain()).received.filter((e) => e.type === 'stock.checkpoint');
    expect(checkpoints.map((e) => [(e.payload as { part: number }).part, (e.payload as { parts: number }).parts, (e.payload as { balances: unknown[] }).balances.length])).toEqual([[1, 3, 2000], [2, 3, 2000], [3, 3, 100]]);
  });
});

describe('after starting', () => {
  beforeEach(() => startCommerce(ctx, u.admin));

  it('every stock movement becomes one event, in order, with its id', async () => {
    const id = product();
    await drain();
    const web = fakeWeb();
    move(id, 5000, 1);
    move(id, -2000, 2);
    await drain(web);
    expect(web.received.map((e) => [e.type, (e.payload as { qty: number }).qty])).toEqual([['stock.movement', 5000], ['stock.movement', -2000]]);
    expect(web.received[0]!.payload).toMatchObject({ productId: id, reason: 'grn', sourceType: 'test', sourceId: 1, sourceLine: 0, orderId: null });
  });

  it('never sends a cost, anywhere', async () => {
    const id = product();
    move(id, 5000, 1);
    const { received } = await drain();
    expect(JSON.stringify(received).toLowerCase()).not.toMatch(/cost/);
  });

  it('numbers events from one with no gaps', async () => {
    const id = product();
    move(id, 1000, 1);
    const { received } = await drain();
    expect(received.map((e) => e.eventId)).toEqual(received.map((_e, i) => `${DEVICE}:0:${i + 1}`));
  });

  it('price, status, barcode and category changes each send the product again', async () => {
    const id = product();
    await drain();
    const web = fakeWeb();
    setPrice(ctx, u.admin, id, 999);
    setProductActive(ctx, u.admin, id, false, 'test');
    addBarcode(id, '6290000000024');
    setProductCategory(ctx, u.admin, id, createProductCategory(ctx, u.admin, 'Dairy'));
    await drain(web);
    const last = web.received.filter((e) => e.type === 'catalog.product').at(-1)!;
    expect(web.received.filter((e) => e.type === 'catalog.product').length).toBeGreaterThanOrEqual(4);
    expect(last.payload).toMatchObject({ priceIncl: 999, active: false, barcodes: ['6290000000024'] });
  });

  it('removes what was acknowledged and keeps what was not', async () => {
    const id = product();
    await drain();
    move(id, 1000, 1);
    move(id, 2000, 2);
    expect(outbox()).toBe(2);
    let first = true;
    const partial: CommerceTransport = { send: async (events) => { const n = Number(events[0]!.eventId.split(':')[2]); if (first) { first = false; return { ackedSeq: n }; } return { ackedSeq: Number(events.at(-1)!.eventId.split(':')[2]) }; } };
    await syncCommerceOnce(ctx, partial, DEVICE);
    expect(outbox()).toBe(1);
    await syncCommerceOnce(ctx, partial, DEVICE);
    expect(outbox()).toBe(0);
  });

  it('a failed send loses nothing and resends the same event ids', async () => {
    const id = product();
    await drain();
    move(id, 1000, 1);
    const seen: string[] = [];
    const down: CommerceTransport = { send: async (events) => { seen.push(events[0]!.eventId); throw new Error('offline'); } };
    await expect(syncCommerceOnce(ctx, down, DEVICE)).rejects.toThrow();
    await expect(syncCommerceOnce(ctx, down, DEVICE)).rejects.toThrow();
    expect(new Set(seen).size).toBe(1);
    expect(outbox()).toBe(1);
  });

  it('survives a long list across rounds', async () => {
    const id = product();
    await drain();
    for (let i = 1; i <= 450; i++) move(id, 1000, i);
    const web = fakeWeb();
    const r = await syncCommerceOnce(ctx, web.transport, DEVICE);
    expect(r.sent).toBe(200);
    await drain(web);
    expect(web.received).toHaveLength(450);
  });

  it('a very long name is shortened rather than blocking the queue', async () => {
    product('LONG', { nameEn: 'x'.repeat(400) });
    const { received } = await drain();
    expect((received.at(-1)!.payload as { nameEn: string }).nameEn.length).toBeLessThanOrEqual(200);
  });
});

describe('the round', () => {
  beforeEach(() => startCommerce(ctx, u.admin));

  it('with nothing to send it still says the POS is alive', async () => {
    await drain();
    let calls = 0;
    await commerceTick(ctx, { send: async (e) => { calls++; expect(e).toEqual([]); return { ackedSeq: 1 }; } }, DEVICE);
    expect(calls).toBe(1);
  });

  it('does nothing when commerce is off', async () => {
    stopCommerce(ctx, u.admin);
    let calls = 0;
    await commerceTick(ctx, { send: async () => { calls++; return { ackedSeq: 0 }; } }, DEVICE);
    expect(calls).toBe(0);
  });

  it('records a failure for the status screen and clears it on success', async () => {
    product();
    const bad = await commerceTick(ctx, { send: async () => { throw new Error('No internet connection'); } }, DEVICE);
    expect(bad.ok).toBe(false);
    expect(commerceStatus(ctx)).toMatchObject({ enabled: true, lastError: 'No internet connection' });
    expect(commerceStatus(ctx).pending).toBeGreaterThan(0);
    expect((await commerceTick(ctx, fakeWeb().transport, DEVICE)).ok).toBe(true);
    expect(commerceStatus(ctx)).toMatchObject({ lastError: null, pending: 0, lastOkAt: ctx.now() });
  });

  it('retries sooner at first and at most every 5 minutes', () => {
    expect(commerceRetryDelayMs(0)).toBe(0);
    expect(commerceRetryDelayMs(1)).toBe(20_000);
    expect(commerceRetryDelayMs(2)).toBe(40_000);
    expect(commerceRetryDelayMs(30)).toBe(300_000);
  });
});

describe('stopping', () => {
  it('clears the queue and stops writing', () => {
    startCommerce(ctx, u.admin);
    stopCommerce(ctx, u.admin);
    expect(outbox()).toBe(0);
    product();
    expect(outbox()).toBe(0);
  });

  it('a new connection starts again from one, with a full load', async () => {
    const id = product();
    startCommerce(ctx, u.admin);
    await drain();
    stopCommerce(ctx, u.admin);
    move(id, 7000, 1);
    startCommerce(ctx, u.admin);
    const { received } = await drain();
    expect(received[0]!.eventId).toBe(`${DEVICE}:0:1`);
    expect(received.at(-1)!.payload).toMatchObject({ balances: [{ productId: id, qty: 7000 }] });
  });
});

describe('product categories', () => {
  it('can be created and listed by name', () => {
    createProductCategory(ctx, u.admin, 'Vegetables');
    createProductCategory(ctx, u.admin, 'Fruits');
    expect(listProductCategories(ctx).map((c) => c.nameEn)).toEqual(['Fruits', 'Vegetables']);
  });

  it('refuses a blank or duplicate name, ignoring case', () => {
    createProductCategory(ctx, u.admin, 'Fruits');
    expect(() => createProductCategory(ctx, u.admin, ' fruits ')).toThrow(/already/);
    expect(() => createProductCategory(ctx, u.admin, '  ')).toThrow();
  });

  it('only a user who manages products can change them', () => {
    expect(() => createProductCategory(ctx, u.cashier, 'Fruits')).toThrow();
    const id = product();
    const cat = createProductCategory(ctx, u.admin, 'Fruits');
    expect(() => setProductCategory(ctx, u.cashier, id, cat)).toThrow();
  });

  it('can be set on a new product, changed and cleared', () => {
    const a = createProductCategory(ctx, u.admin, 'Fruits');
    const b = createProductCategory(ctx, u.admin, 'Dairy');
    const id = product('A', { categoryId: a });
    expect(productCategory(ctx, id)).toBe(a);
    setProductCategory(ctx, u.admin, id, b);
    expect(productCategory(ctx, id)).toBe(b);
    setProductCategory(ctx, u.admin, id, null);
    expect(productCategory(ctx, id)).toBeNull();
  });

  it('refuses a category that does not exist', () => {
    const id = product();
    expect(() => setProductCategory(ctx, u.admin, id, 999)).toThrow();
    expect(() => product('B', { categoryId: 999 })).toThrow();
  });

  it('changes are in the audit log', () => {
    const id = product();
    setProductCategory(ctx, u.admin, id, createProductCategory(ctx, u.admin, 'Fruits'));
    expect((ctx.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action IN ('category.create', 'product.category')").get() as { n: number }).n).toBe(2);
  });
});

describe('after outages and restores', () => {
  beforeEach(() => startCommerce(ctx, u.admin));

  it('tells the website how much is still waiting after each batch', async () => {
    const id = product();
    await drain();
    for (let i = 1; i <= 250; i++) move(id, 1000, i);
    const seen: number[] = [];
    const web: CommerceTransport = { send: async (events, pending) => { seen.push(pending ?? -1); return { ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0 }; } };
    await commerceTick(ctx, web, DEVICE);
    expect(seen).toEqual([50, 0]);
  });

  it('sends a full stock check when the website asks, once', async () => {
    product();
    await drain();
    const kinds: string[] = [];
    let ask = true;
    const web: CommerceTransport = { send: async (events) => { kinds.push(...events.map((e) => e.type)); const need = ask; if (events.some((e) => e.type === 'stock.checkpoint')) ask = false; return { ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0, needCheckpoint: need }; } };
    await commerceTick(ctx, web, DEVICE);
    await commerceTick(ctx, web, DEVICE);
    expect(kinds.filter((k) => k === 'stock.checkpoint')).toHaveLength(1);
  });

  it('sends a full stock check once each store day', async () => {
    await drain();
    const kinds: string[] = [];
    const web: CommerceTransport = { send: async (events) => { kinds.push(...events.map((e) => e.type)); return { ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0 }; } };
    await commerceTick(ctx, web, DEVICE);
    expect(kinds).toEqual([]);
    t.advance(86_400_000);
    await commerceTick(ctx, web, DEVICE);
    await commerceTick(ctx, web, DEVICE);
    expect(kinds).toEqual(['stock.checkpoint']);
  });

  it('uses the epoch in every event id', async () => {
    product();
    const ids: string[] = [];
    await commerceTick(ctx, { send: async (events) => { ids.push(...events.map((e) => e.eventId)); return { ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0 }; } }, DEVICE, 3);
    expect(ids.every((x) => x.startsWith(`${DEVICE}:3:`))).toBe(true);
  });

  it('after a backup restore, starts the queue again from one with a full load', async () => {
    const id = product();
    move(id, 4000, 1);
    restartAfterRestore(ctx);
    const { received } = await drain();
    expect(received[0]!.eventId).toBe(`${DEVICE}:0:1`);
    expect(received.at(-1)).toMatchObject({ type: 'stock.checkpoint', payload: { balances: [{ productId: id, qty: 4000 }] } });
  });

  it('a restore does nothing while the online store is off', () => {
    stopCommerce(ctx, u.admin);
    restartAfterRestore(ctx);
    expect(outbox()).toBe(0);
  });

  it('keeps the held-online figures for the stock report, never mixing them into stock', async () => {
    const id = product();
    move(id, 5000, 1);
    await commerceTick(ctx, { send: async (events) => ({ ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0 }), reserved: async () => [{ productId: id, reserved: 2000 }, { productId: 999, reserved: 1000 }] }, DEVICE);
    expect(ctx.db.prepare('SELECT product_id, reserved FROM commerce_reserved').all()).toEqual([{ product_id: id, reserved: 2000 }]);
    expect((ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number }).qty).toBe(5000);
  });
});
