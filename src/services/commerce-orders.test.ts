import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../db/migrations';
import { createProduct, setPrice } from './catalog';
import { applyCommands, handOverOrder, onlineOrders } from './commerce-orders';
import { startCommerce, syncCommerceOnce, type CommerceEvent } from './commerce-sync';
import type { Ctx } from './context';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { cashierActivity, salesSummary, stockOnHand } from './reports';
import { finalizeSale } from './sales';
import { runChecks } from './integrity';
import { storeDay } from '../core/store-time';

const ORDER = '22222222-2222-4222-8222-222222222222';
const DEVICE = '11111111-1111-4111-8111-111111111111';
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let apple: number;
let milk: number;

const accepted = (id = 1, orderId = ORDER, lines = [{ productId: apple, qty: 1500, unitPriceIncl: 899, discount: 0, isEstimate: true }, { productId: milk, qty: 2000, unitPriceIncl: 700, discount: 0, isEstimate: false }]) => ({
  id, type: 'order.accepted', payload: { orderId, publicRef: 'ABCD-EFGH', fulfilment: 'pickup', paymentMethod: 'pay_at_pickup', customerName: 'Made Up Shopper', phone: '+966512345678', lines, deliveryFeeIncl: 0 },
});
const qty = (id: number) => (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number }).qty;
const cash = (amount: number) => [{ tender: 'cash' as const, amount }];

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  apple = createProduct(ctx, u.admin, { sku: 'APL', nameAr: 'تفاح', nameEn: 'Made up apples', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 899 });
  milk = createProduct(ctx, u.admin, { sku: 'MLK', nameAr: 'حليب', nameEn: 'Made up milk', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 700 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Made Up Farm' }), lines: [{ productId: apple, qty: 20_000, unitCost: 500 }, { productId: milk, qty: 20_000, unitCost: 400 }] });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('orders arriving from the website', () => {
  it('an accepted order waits at the POS, with the shop names and prices', () => {
    expect(applyCommands(ctx, [accepted()])).toBe(1);
    const [o] = onlineOrders(ctx, u.cashier);
    expect(o).toMatchObject({ orderId: ORDER, publicRef: 'ABCD-EFGH', status: 'waiting', customerName: 'Made Up Shopper', fulfilment: 'pickup' });
    expect(o!.lines).toEqual([
      { productId: apple, name: 'Made up apples', sellMode: 'weight', qty: 1500, unitPriceIncl: 899, priceNow: 899, vatRateBp: 1500, isEstimate: true },
      { productId: milk, name: 'Made up milk', sellMode: 'unit', qty: 2000, unitPriceIncl: 700, priceNow: 700, vatRateBp: 1500, isEstimate: false },
    ]);
  });

  it('the same command twice makes one order', () => {
    applyCommands(ctx, [accepted()]);
    applyCommands(ctx, [accepted()]);
    expect(onlineOrders(ctx, u.cashier)).toHaveLength(1);
  });

  it('remembers how far it has read', () => {
    expect(applyCommands(ctx, [accepted(4)])).toBe(4);
    expect((ctx.db.prepare("SELECT value FROM settings WHERE key = 'commerce_command_cursor'").get() as { value: string }).value).toBe('4');
  });

  it('a cancellation from the website stops the handover', () => {
    applyCommands(ctx, [accepted(), { id: 2, type: 'order.cancelled', payload: { orderId: ORDER, reason: 'Customer phoned' } }]);
    expect(onlineOrders(ctx, u.cashier)[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Customer phoned' });
    expect(() => handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) })).toThrow(/cancelled/);
  });

  it('an unknown command is skipped without stopping the rest', () => {
    expect(applyCommands(ctx, [{ id: 1, type: 'something.new', payload: {} }, accepted(2)])).toBe(2);
    expect(onlineOrders(ctx, u.cashier)).toHaveLength(1);
  });

  it('shows when the POS price changed after the order', () => {
    applyCommands(ctx, [accepted()]);
    setPrice(ctx, u.admin, milk, 750);
    expect(onlineOrders(ctx, u.cashier)[0]!.lines[1]).toMatchObject({ unitPriceIncl: 700, priceNow: 750 });
  });
});

describe('handing over', () => {
  beforeEach(() => applyCommands(ctx, [accepted()]));

  it('makes one normal sale with an invoice, takes the stock and closes the order', () => {
    const r = handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: apple, qty: 1620 }, { productId: milk, qty: 2000 }], payments: cash(5000) });
    expect(r.invoiceNo).toMatch(/^INV-\d{8}$/);
    expect(r.totalIncl).toBe(1456 + 1400); // 1.62 kg at 8.99 is 14.56, plus two milks
    expect(qty(apple)).toBe(20_000 - 1620);
    expect(qty(milk)).toBe(18_000);
    expect(onlineOrders(ctx, u.cashier)[0]).toMatchObject({ status: 'handed_over', invoiceNo: r.invoiceNo });
  });

  it('pressing twice gives the same sale, never two', () => {
    const a = handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) });
    const b = handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) });
    expect(b.saleId).toBe(a.saleId);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(1);
  });

  it('the customer can take less than ordered, not more', () => {
    expect(() => handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 3000 }], payments: cash(2100) })).toThrow(/more than was ordered/);
    expect(handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 1000 }], payments: cash(700) }).totalIncl).toBe(700);
  });

  it('refuses a product that was not in the order', () => {
    const other = createProduct(ctx, u.admin, { sku: 'OTH', nameAr: 'آخر', nameEn: 'Other', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 100 });
    expect(() => handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: other, qty: 1000 }], payments: cash(100) })).toThrow(/not in this order/);
  });

  it('stops when the POS price changed, until the cashier agrees to today\'s price', () => {
    setPrice(ctx, u.admin, milk, 750);
    expect(() => handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1500) })).toThrow(/changed/);
    expect(handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1500), useCurrentPrices: true }).totalIncl).toBe(1500);
  });

  it('an unknown order is refused', () => {
    expect(() => handOverOrder(ctx, u.cashier, { orderId: '33333333-3333-4333-8333-333333333333', lines: [{ productId: milk, qty: 1000 }], payments: cash(700) })).toThrow(/not found/i);
  });
});

describe('what the website is told', () => {
  it('the sale movements carry the order, then one handover event follows', async () => {
    startCommerce(ctx, u.admin);
    const received: CommerceEvent[] = [];
    const web = { send: async (events: CommerceEvent[]) => { received.push(...events); return { ackedSeq: events.length ? Number(events.at(-1)!.eventId.split(':')[2]) : 0 }; } };
    while ((await syncCommerceOnce(ctx, web, DEVICE)).sent > 0) { /* drain the first load */ }
    received.length = 0;
    applyCommands(ctx, [accepted()]);
    const r = handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) });
    while ((await syncCommerceOnce(ctx, web, DEVICE)).sent > 0) { /* send */ }
    const moves = received.filter((e) => e.type === 'stock.movement');
    expect(moves.map((e) => (e.payload as { orderId: string | null }).orderId)).toEqual([ORDER]);
    expect(received.at(-1)).toMatchObject({ type: 'order.handed_over', payload: { orderId: ORDER, invoiceNo: r.invoiceNo, saleUuid: r.uuid, totalIncl: 1400 } });
  });

  it('with the online store switched off, a handover still works and nothing is queued', () => {
    applyCommands(ctx, [accepted()]);
    handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) });
    expect((ctx.db.prepare('SELECT count(*) AS n FROM commerce_outbox').get() as { n: number }).n).toBe(0);
  });
});

describe('upgrading the database', () => {
  it('keeps the event numbering when the queue is rebuilt, so the website sees no gap or repeat', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for (const m of MIGRATIONS.filter((x) => x.version <= 18)) db.exec(m.sql);
    db.prepare("INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', 1), ('catalog.product', 2), ('catalog.product', 3)").run();
    db.prepare('DELETE FROM commerce_outbox WHERE seq <= 2').run();
    db.exec(MIGRATIONS.find((x) => x.version === 19)!.sql);
    db.prepare("INSERT INTO commerce_outbox (type, row_id) VALUES ('catalog.product', 4)").run();
    expect(db.prepare('SELECT seq FROM commerce_outbox ORDER BY seq').all()).toEqual([{ seq: 3 }, { seq: 4 }]);
    db.prepare('DELETE FROM commerce_outbox').run();
    db.prepare("INSERT INTO commerce_outbox (type, row_id) VALUES ('order.handed_over', 1)").run();
    expect(db.prepare('SELECT seq FROM commerce_outbox').all()).toEqual([{ seq: 5 }]);
    db.close();
  });
});

describe('reports show online sales', () => {
  const today = () => storeDay(ctx.now());
  beforeEach(() => {
    applyCommands(ctx, [accepted()]);
    handOverOrder(ctx, u.cashier, { orderId: ORDER, lines: [{ productId: milk, qty: 2000 }], payments: cash(1400) });
    finalizeSale(ctx, u.cashier, { idempotencyKey: 'in-store-sale-1', lines: [{ productId: milk, qty: 1000 }], payments: cash(700) });
  });

  it('splits sales into in store and online, and counts online pickups', () => {
    const s = salesSummary(ctx, u.admin, today(), today());
    expect(s.saleCount).toBe(2);
    expect(s.totalIncl).toBe(2100);
    expect(s.channels).toEqual({ inStore: { count: 1, totalIncl: 700 }, online: { count: 1, totalIncl: 1400, pickup: 1, delivery: 0 } });
  });

  it('top products show how much of each sold online', () => {
    expect(salesSummary(ctx, u.admin, today(), today()).topProducts[0]).toMatchObject({ productId: milk, qty: 3000, totalIncl: 2100, onlineQty: 2000, onlineTotalIncl: 1400 });
  });

  it('cashier activity counts online handovers', () => {
    expect(cashierActivity(ctx, u.admin, today(), today()).find((a) => a.userId === u.cashier)).toMatchObject({ sales: 2, onlineHandovers: 1 });
  });

  it('the money and stock checks stay clean with online sales mixed in', () => {
    expect(runChecks(ctx)).toEqual([]);
  });

  it('stock on hand shows what online orders are holding', () => {
    ctx.db.prepare('INSERT INTO commerce_reserved (product_id, reserved, as_of) VALUES (?, ?, ?)').run(apple, 1500, ctx.now());
    const rows = stockOnHand(ctx, u.admin);
    expect(rows.find((r) => r.productId === apple)).toMatchObject({ reservedOnline: 1500 });
    expect(rows.find((r) => r.productId === milk)).toMatchObject({ reservedOnline: 0 });
  });
});
