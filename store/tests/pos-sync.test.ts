import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createProductCategory, setPrice, setProductActive } from '../../src/services/catalog';
import { commerceTick, startCommerce, syncCommerceOnce, type CommerceTransport } from '../../src/services/commerce-sync';
import type { Ctx } from '../../src/services/context';
import { recordWastage, postStockCount } from '../../src/services/adjustments';
import { receiveGoods } from '../../src/services/inventory';
import { createSupplier } from '../../src/services/parties';
import { createRefund } from '../../src/services/refunds';
import { finalizeSale } from '../../src/services/sales';
import { openShift } from '../../src/services/shifts';
import { makeTestCtx, seedUsers } from '../../src/services/test-helpers';
import { getProduct, listCategories, stockIsFresh } from '../src/server/catalog-core.ts';
import { ackCommands, applyEvents, authenticate, enrollDevice, pendingCommands } from '../src/server/device-core.ts';
import { attemptLogin, readSession } from '../src/server/auth-core.ts';
import { changeOrderStatus, getOrderForStaff } from '../src/server/admin-core.ts';
import { getOrderForCustomer, placeOrder } from '../src/server/order-core.ts';
import { handOverOrder, onlineOrders } from '../../src/services/commerce-orders';
import { eventBatch, posCommand } from '../src/shared/commerce-events.ts';
import { addCode, addStaff, makeCloud, TEST_PASSWORD, type TestCloud } from './helpers.ts';

// The real POS, on a real SQLite file, using its real sale, goods, refund and count code, talking to the real web engine.
// The only thing replaced is the network. Everything passes through the strict contract, as it does in production.

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let c: TestCloud;
let deviceId: string;
let web: CommerceTransport;
let sentBytes: string[];
let n = 0;
const key = () => `pos-sync-key-${++n}`;

beforeEach(async () => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  c = await makeCloud();
  await addCode(c, 'made-up-code-1');
  const device = await enrollDevice(c.device, '203.0.113.1', { code: 'made-up-code-1', deviceName: 'Made up till' });
  deviceId = device.deviceId;
  sentBytes = [];
  web = {
    send: async (events) => {
      const body = JSON.stringify({ events });
      sentBytes.push(body);
      const who = await authenticate(c.device, `Bearer ${device.deviceId}.${device.deviceSecret}`);
      return applyEvents(c.device, who, eventBatch.parse(JSON.parse(body)).events);
    },
    commands: async (after) => (await pendingCommands(c.device, after)).map((x) => posCommand.parse(x)),
    ack: async (ids) => ackCommands(c.device, ids),
  };
});
afterEach(async () => {
  t.cleanup();
  await c.pg.close();
});

const sync = async () => {
  for (let i = 0; i < 100; i++) if ((await syncCommerceOnce(ctx, web, deviceId)).sent === 0) return;
  throw new Error('never drained');
};
const product = (sku: string, extra: object = {}) => createProduct(ctx, u.admin, { sku, nameAr: 'تجربة', nameEn: `Made up ${sku}`, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000, ...extra });
const posQty = (id: number) => (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number } | undefined)?.qty ?? 0;
const webRow = async (id: number) => (await c.owner.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM commerce.inventory_positions WHERE pos_product_id = $1', [id]))[0]!;
const publish = () => c.owner.query("UPDATE commerce.web_products SET status = 'published'");
const receive = (id: number, qty: number) => receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: `Made up ${++n}` }), lines: [{ productId: id, qty, unitCost: 600 }] });
const sell = (id: number, qty: number) => finalizeSale(ctx, u.admin, { idempotencyKey: key(), lines: [{ productId: id, qty }], payments: [{ tender: 'cash', amount: 1_000_000 }] });

describe('first connection', () => {
  it('loads the whole catalogue and matching stock, unpublished', async () => {
    const cat = createProductCategory(ctx, u.admin, 'Fruits');
    const a = product('A', { categoryId: cat, barcodes: ['6290000000017'] });
    const b = product('B');
    receive(a, 7000);
    startCommerce(ctx, u.admin);
    await sync();
    expect(await webRow(a)).toMatchObject({ on_hand: 7000, reserved: 0 });
    expect(await webRow(b)).toMatchObject({ on_hand: 0 });
    expect(await getProduct(c.app, a)).toBeNull();
    await publish();
    expect((await getProduct(c.app, a))!.availability).toEqual({ state: 'in_stock', available: 7000 });
    expect((await listCategories(c.app)).map((x) => x.name)).toEqual(['Fruits']);
  });

  it('counts the POS as fresh once it has been heard from', async () => {
    await c.owner.query('UPDATE commerce.devices SET last_seen_at = NULL');
    startCommerce(ctx, u.admin);
    expect(await stockIsFresh(c.app)).toBe(false);
    await commerceTick(ctx, web, deviceId);
    expect(await stockIsFresh(c.app)).toBe(true);
  });
});

describe('every kind of stock change reaches the web exactly once', () => {
  let id: number;
  beforeEach(async () => {
    id = product('A');
    receive(id, 20_000);
    startCommerce(ctx, u.admin);
    await sync();
    openShift(ctx, u.admin, 0);
  });

  const inStep = async () => {
    await sync();
    expect((await webRow(id)).on_hand).toBe(posQty(id));
  };

  it('goods received', async () => {
    receive(id, 5000);
    await inStep();
    expect(posQty(id)).toBe(25_000);
  });

  it('a sale', async () => {
    sell(id, 3000);
    await inStep();
    expect(posQty(id)).toBe(17_000);
  });

  it('a refund that goes back on the shelf', async () => {
    const s = sell(id, 3000);
    await sync();
    createRefund(ctx, u.supervisor, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'Return', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] });
    await inStep();
    expect(posQty(id)).toBe(18_000);
  });

  it('wastage', async () => {
    recordWastage(ctx, u.admin, { requestKey: key(), reason: 'Spoiled', lines: [{ productId: id, qty: 1000 }] });
    await inStep();
  });

  it('a stock count', async () => {
    postStockCount(ctx, u.admin, { requestKey: key(), reason: 'Count', lines: [{ productId: id, countedQty: 15_000 }] });
    await inStep();
    expect(posQty(id)).toBe(15_000);
  });

  it('a mix of everything, one event for each ledger row', async () => {
    const before = (ctx.db.prepare('SELECT count(*) AS n FROM stock_movements').get() as { n: number }).n;
    receive(id, 5000);
    const s = sell(id, 2000);
    createRefund(ctx, u.supervisor, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'Return', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] });
    recordWastage(ctx, u.admin, { requestKey: key(), reason: 'Spoiled', lines: [{ productId: id, qty: 1000 }] });
    await inStep();
    const ledger = (ctx.db.prepare('SELECT count(*) AS n FROM stock_movements').get() as { n: number }).n - before;
    const [row] = await c.owner.query<{ n: string | number }>("SELECT count(*) AS n FROM commerce.sync_inbox WHERE type = 'stock.movement'");
    expect(Number(row!.n)).toBe(ledger);
  });
});

describe('when the network misbehaves', () => {
  let id: number;
  beforeEach(async () => {
    id = product('A');
    receive(id, 20_000);
    startCommerce(ctx, u.admin);
    await sync();
    openShift(ctx, u.admin, 0);
  });

  it('selling carries on offline, and everything lands once on reconnect', async () => {
    const offline: CommerceTransport = { send: async () => { throw new Error('No internet'); } };
    sell(id, 1000);
    expect((await commerceTick(ctx, offline, deviceId)).ok).toBe(false);
    sell(id, 1000);
    expect((await commerceTick(ctx, offline, deviceId)).ok).toBe(false);
    expect(posQty(id)).toBe(18_000);
    expect((await webRow(id)).on_hand).toBe(20_000);
    expect((await commerceTick(ctx, web, deviceId)).ok).toBe(true);
    expect((await webRow(id)).on_hand).toBe(18_000);
  });

  it('the web applied it but the answer was lost: nothing is counted twice', async () => {
    sell(id, 1000);
    const answerLost: CommerceTransport = { send: async (events) => { await web.send(events); throw new Error('Connection dropped'); } };
    await expect(syncCommerceOnce(ctx, answerLost, deviceId)).rejects.toThrow();
    await sync();
    expect((await webRow(id)).on_hand).toBe(19_000);
  });
});

describe('product changes reach the web', () => {
  it('price and stopped products', async () => {
    const id = product('A');
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    await publish();
    setPrice(ctx, u.admin, id, 1234);
    await sync();
    expect((await getProduct(c.app, id))!.priceIncl).toBe(1234);
    setProductActive(ctx, u.admin, id, false, 'Stopped');
    await sync();
    expect(await getProduct(c.app, id)).toBeNull();
  });

  it('a new product arrives unpublished, with its opening stock', async () => {
    startCommerce(ctx, u.admin);
    await sync();
    const id = product('NEW');
    receive(id, 4000);
    await sync();
    expect(await webRow(id)).toMatchObject({ on_hand: 4000 });
    expect(await getProduct(c.app, id)).toBeNull();
  });
});

describe('the prompt scenario, with the real POS', () => {
  it('5 units, the web reserves 3, the POS sells 2: nothing negative, nothing oversold', async () => {
    const id = product('A');
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    await publish();
    openShift(ctx, u.admin, 0);
    const [o] = await c.owner.query<{ id: string }>(`INSERT INTO commerce.orders (public_ref, access_token_hash, idempotency_key, fulfilment, customer_name, phone, items_incl, eligible_subtotal, total_incl, total_vat) VALUES ('r1', 'h', 'k1', 'pickup', 'Made Up', '0500000000', 3000, 2609, 3000, 391) RETURNING id`);
    await c.app.query("SELECT commerce.place_order_reserve($1, $2::jsonb, now() + interval '30 minutes')", [o!.id, JSON.stringify([{ productId: id, qty: 3000 }])]);
    sell(id, 2000);
    await sync();
    expect(await webRow(id)).toMatchObject({ on_hand: 3000, reserved: 3000 });
    expect(posQty(id)).toBe(3000);
    expect((await getProduct(c.app, id))!.availability).toEqual({ state: 'out', available: 0 });
  });
});

describe('what leaves the POS', () => {
  it('no cost figure in any byte sent, even with real costs on the books', async () => {
    const id = product('A');
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    openShift(ctx, u.admin, 0);
    sell(id, 1000);
    await sync();
    const all = sentBytes.join('\n');
    expect(all.length).toBeGreaterThan(100);
    expect(all.toLowerCase()).not.toContain('cost');
    expect(all).not.toContain('avg');
  });
});

describe('an online order from start to finish, with the real POS', () => {
  it('placed online, accepted by staff, handed over at the till, completed online, stock counted once', async () => {
    const id = product('MILK', { priceIncl: 700 });
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    await publish();
    openShift(ctx, u.admin, 0);

    const token = 'x'.repeat(43);
    const { publicRef } = await placeOrder(c.app, { idempotencyKey: 'e2e-order-1', accessToken: token, fulfilment: 'pickup', customerName: 'Made Up Shopper', phone: '0512345678', paymentMethod: 'pay_at_pickup', lines: [{ productId: id, qty: 2000 }], expectedTotal: 1400 }, '203.0.113.50');
    expect(await webRow(id)).toMatchObject({ on_hand: 5000, reserved: 2000 });

    await addStaff(c, 'owner9', 'admin');
    const login = await attemptLogin(c.app, 'owner9', TEST_PASSWORD, '203.0.113.51');
    const staff = (await readSession(c.app, (login as { token: string }).token))!;
    const [{ id: orderId }] = (await c.owner.query<{ id: string }>('SELECT id FROM commerce.orders WHERE public_ref = $1', [publicRef])) as [{ id: string }];
    await changeOrderStatus(c.app, staff, { orderId, to: 'accepted', version: 1 });

    expect(await commerceTick(ctx, web, deviceId)).toEqual({ ok: true });
    const waiting = onlineOrders(ctx, u.admin);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ orderId, publicRef, status: 'waiting' });
    expect(await pendingCommands(c.device, 0)).toEqual([]);

    const sale = handOverOrder(ctx, u.admin, { orderId, lines: [{ productId: id, qty: 2000 }], payments: [{ tender: 'cash', amount: 2000 }] });
    expect(sale.changeGiven).toBe(600);
    expect(posQty(id)).toBe(3000);
    expect(await commerceTick(ctx, web, deviceId)).toEqual({ ok: true });

    const seen = await getOrderForCustomer(c.app, publicRef, token, '192.0.2.1');
    expect(seen).toMatchObject({ status: 'completed', paymentStatus: 'paid' });
    const forStaff = await getOrderForStaff(c.app, staff, orderId);
    expect(forStaff).toMatchObject({ posInvoiceNo: sale.invoiceNo, amountPaid: 1400 });
    expect(await webRow(id)).toEqual({ on_hand: 3000, reserved: 0 });
  });

  it('a cancellation from staff reaches the POS before it is handed over', async () => {
    const id = product('MILK', { priceIncl: 700 });
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    await publish();
    const { publicRef } = await placeOrder(c.app, { idempotencyKey: 'e2e-order-2', accessToken: 'y'.repeat(43), fulfilment: 'pickup', customerName: 'Made Up Shopper', phone: '0512345679', paymentMethod: 'pay_at_pickup', lines: [{ productId: id, qty: 1000 }], expectedTotal: 700 }, '203.0.113.52');
    await addStaff(c, 'owner8', 'admin');
    const login = await attemptLogin(c.app, 'owner8', TEST_PASSWORD, '203.0.113.53');
    const staff = (await readSession(c.app, (login as { token: string }).token))!;
    const [{ id: orderId }] = (await c.owner.query<{ id: string }>('SELECT id FROM commerce.orders WHERE public_ref = $1', [publicRef])) as [{ id: string }];
    await changeOrderStatus(c.app, staff, { orderId, to: 'accepted', version: 1 });
    await commerceTick(ctx, web, deviceId);
    await changeOrderStatus(c.app, staff, { orderId, to: 'cancelled', version: 2, reason: 'Customer phoned' });
    await commerceTick(ctx, web, deviceId);
    expect(onlineOrders(ctx, u.admin)[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Customer phoned' });
    expect(await webRow(id)).toMatchObject({ reserved: 0 });
  });
});

describe('a backup restored on the real POS', () => {
  it('an order already handed over cannot be handed over again from the restored data', async () => {
    const { copyFileSync, rmSync } = await import('node:fs');
    const { openDatabase } = await import('../../src/db/connection');
    const { restartAfterRestore } = await import('../../src/services/commerce-sync');
    const id = product('MILK', { priceIncl: 700 });
    receive(id, 5000);
    startCommerce(ctx, u.admin);
    await sync();
    await publish();
    openShift(ctx, u.admin, 0);
    const { publicRef } = await placeOrder(c.app, { idempotencyKey: 'restore-order-1', accessToken: 'z'.repeat(43), fulfilment: 'pickup', customerName: 'Made Up Shopper', phone: '0512345670', paymentMethod: 'pay_at_pickup', lines: [{ productId: id, qty: 1000 }], expectedTotal: 700 }, '203.0.113.60');
    await addStaff(c, 'owner7', 'admin');
    const login = await attemptLogin(c.app, 'owner7', TEST_PASSWORD, '203.0.113.61');
    const staff = (await readSession(c.app, (login as { token: string }).token))!;
    const [{ id: orderId }] = (await c.owner.query<{ id: string }>('SELECT id FROM commerce.orders WHERE public_ref = $1', [publicRef])) as [{ id: string }];
    await changeOrderStatus(c.app, staff, { orderId, to: 'accepted', version: 1 });
    await commerceTick(ctx, web, deviceId);

    // The backup is taken while the order is waiting at the POS.
    ctx.db.pragma('wal_checkpoint(TRUNCATE)');
    const backup = `${t.path}.backup`;
    copyFileSync(t.path, backup);

    handOverOrder(ctx, u.admin, { orderId, lines: [{ productId: id, qty: 1000 }], payments: [{ tender: 'cash', amount: 700 }] });
    await commerceTick(ctx, web, deviceId);
    expect((await getOrderForCustomer(c.app, publicRef, 'z'.repeat(43), '192.0.2.1'))!.status).toBe('completed');

    // Restore: the POS thinks the order is still waiting.
    ctx.db.close();
    copyFileSync(backup, t.path);
    rmSync(`${t.path}-wal`, { force: true });
    rmSync(`${t.path}-shm`, { force: true });
    ctx.db = openDatabase(t.path);
    expect(onlineOrders(ctx, u.admin)[0]).toMatchObject({ orderId, status: 'waiting' });
    restartAfterRestore(ctx);

    expect(await commerceTick(ctx, web, deviceId, 1)).toEqual({ ok: true });
    expect(await commerceTick(ctx, web, deviceId, 1)).toEqual({ ok: true });
    expect(onlineOrders(ctx, u.admin)[0]).toMatchObject({ orderId, status: 'cancelled' });
    expect(() => handOverOrder(ctx, u.admin, { orderId, lines: [{ productId: id, qty: 1000 }], payments: [{ tender: 'cash', amount: 700 }] })).toThrow(/cancelled/);
    expect(await stockIsFresh(c.app)).toBe(true);
  });
});
