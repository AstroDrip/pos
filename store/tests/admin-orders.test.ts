import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminSummary, changeOrderStatus, getOrderForStaff, listOrders, listProductsForStaff, setProductStatus, updateProductWeb } from '../src/server/admin-core.ts';
import { readSession, attemptLogin, type StaffUser } from '../src/server/auth-core.ts';
import { ackCommands, applyEvents, pendingCommands } from '../src/server/device-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { getOrderForCustomer, placeOrder } from '../src/server/order-core.ts';
import { addStaff, makeCloud, TEST_PASSWORD, type TestCloud } from './helpers.ts';

let c: TestCloud;
let admin: StaffUser;
let cashier: StaffUser;
let deviceId: string;
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));

async function login(name: string, role: 'admin' | 'cashier') {
  await addStaff(c, name, role);
  const r = await attemptLogin(c.app, name, TEST_PASSWORD, '203.0.113.1');
  if (!r.ok) throw new Error('login');
  return (await readSession(c.app, r.token))!;
}

beforeEach(async () => {
  c = await makeCloud();
  [{ id: deviceId }] = (await c.owner.query<{ id: string }>("INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Made up till', 'h', now()) RETURNING id")) as [{ id: string }];
  for (const [id, onHand, price] of [[1, 5000, 1150], [2, 10_000, 500]] as const) {
    await c.owner.query(`INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, $3, '', 'PCS', 'unit', $4, 1500, true)`, [id, `SKU-${id}`, `Made up ${id}`, price]);
    await c.owner.query("INSERT INTO commerce.web_products (pos_product_id, status) VALUES ($1, 'published')", [id]);
    await c.owner.query('INSERT INTO commerce.inventory_positions (pos_product_id, on_hand) VALUES ($1, $2)', [id, onHand]);
  }
  admin = await login('owner1', 'admin');
  cashier = await login('cash1', 'cashier');
});
afterEach(() => c.pg.close());

let n = 0;
async function newOrder(lines = [{ productId: 1, qty: 2000 }], total = 2300) {
  const token = randomBytes(32).toString('base64url');
  const { publicRef } = await placeOrder(c.app, { idempotencyKey: `k-${++n}-${randomBytes(4).toString('hex')}`, accessToken: token, fulfilment: 'pickup', customerName: 'Made Up Shopper', phone: `05${String(20_000_000 + n)}`, paymentMethod: 'pay_at_pickup', lines, expectedTotal: total }, `198.51.100.${n}`);
  const [o] = await c.owner.query<{ id: string; version: number }>('SELECT id, version FROM commerce.orders WHERE public_ref = $1', [publicRef]);
  return { id: o!.id, version: o!.version, publicRef, token };
}
const move = (o: { id: string; version: number }, to: string, user = admin, reason?: string) => changeOrderStatus(c.app, user, { orderId: o.id, to: to as never, version: o.version, reason });
const stock = async (id: number) => (await c.owner.query<{ on_hand: number; reserved: number }>('SELECT on_hand, reserved FROM commerce.inventory_positions WHERE pos_product_id = $1', [id]))[0]!;
const version = async (id: string) => (await c.owner.query<{ version: number }>('SELECT version FROM commerce.orders WHERE id = $1', [id]))[0]!.version;

describe('accepting', () => {
  it('accepts, records who did it, stops the expiry clock and tells the POS', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    const d = await getOrderForStaff(c.app, admin, o.id);
    expect(d.status).toBe('accepted');
    expect(d.lines[0]).toHaveProperty('sellMode', 'unit'); // staff see the unit for weighed goods, like the customer
    expect(d.history.at(-1)).toMatchObject({ status: 'accepted', staff: 'Test owner1', actor: 'staff' });
    const [row] = await c.owner.query<{ expires_at: Date | null }>('SELECT expires_at FROM commerce.orders WHERE id = $1', [o.id]);
    expect(row!.expires_at).toBeNull();
    const cmds = await pendingCommands(c.device, 0);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ type: 'order.accepted', payload: { orderId: o.id, publicRef: o.publicRef, fulfilment: 'pickup', paymentMethod: 'pay_at_pickup', customerName: 'Made Up Shopper', lines: [{ productId: 1, qty: 2000, unitPriceIncl: 1150, discount: 0, isEstimate: false }], deliveryFeeIncl: 0 } });
  });

  it('a cashier cannot accept, only move orders along', async () => {
    const o = await newOrder();
    expect(await code(move(o, 'accepted', cashier))).toBe('403 FORBIDDEN');
  });

  it('two staff accepting at once: the second is told it changed', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    expect(await code(move(o, 'accepted'))).toBe('409 CHANGED');
  });

  it('cannot skip steps', async () => {
    const o = await newOrder();
    expect(await code(move(o, 'completed'))).toBe('409 BAD_TRANSITION');
    expect(await code(move(o, 'preparing'))).toBe('409 BAD_TRANSITION');
  });

  it('refuses while the POS is out of date', async () => {
    const o = await newOrder();
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '1 hour'");
    const e = await move(o, 'accepted').catch((x: ApiError) => x);
    expect((e as ApiError).code).toBe('CANNOT_ACCEPT');
    expect((e as ApiError).details).toEqual([{ sku: null, name: null, problem: 'The POS has not been heard from recently, so stock cannot be confirmed.' }]);
  });

  it('names the line when the POS sold the stock meanwhile', async () => {
    const o = await newOrder();
    await applyEvents(c.device, { deviceId }, [{ eventId: `${deviceId}:0:1`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'stock.movement', payload: { movementId: 1, productId: 1, qty: -4000, reason: 'sale', sourceType: 'sale', sourceId: 1, sourceLine: 0, orderId: null } }]);
    const e = await move(o, 'accepted').catch((x: ApiError) => x);
    expect((e as ApiError).code).toBe('CANNOT_ACCEPT');
    expect((e as ApiError).details).toEqual([{ sku: 'SKU-1', name: 'Made up 1', problem: 'Short by 1. On hand 1, held for online orders 2.' }]);
    expect((await getOrderForStaff(c.app, admin, o.id)).status).toBe('placed');
  });

  it('names the line when the product was unpublished', async () => {
    const o = await newOrder();
    await c.owner.query("UPDATE commerce.web_products SET status = 'unpublished' WHERE pos_product_id = 1");
    const e = await move(o, 'accepted').catch((x: ApiError) => x);
    expect((e as ApiError).details).toEqual([{ sku: 'SKU-1', name: 'Made up 1', problem: 'No longer published online.' }]);
  });
});

describe('rejecting and cancelling', () => {
  it('rejecting needs a reason', async () => {
    const o = await newOrder();
    expect(await code(move(o, 'rejected', admin, ' '))).toBe('400 REASON_REQUIRED');
  });

  it('rejecting gives the stock back and the customer sees why', async () => {
    const o = await newOrder();
    await move(o, 'rejected', admin, 'Out of fresh stock today');
    expect(await stock(1)).toMatchObject({ reserved: 0 });
    const seen = await getOrderForCustomer(c.app, o.publicRef, o.token, '192.0.2.1');
    expect(seen).toMatchObject({ status: 'rejected', paymentStatus: 'cancelled', rejectionReason: 'Out of fresh stock today' });
    expect(await pendingCommands(c.device, 0)).toEqual([]);
  });

  it('cancelling an accepted order tells the POS to drop it', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    await move({ id: o.id, version: await version(o.id) }, 'cancelled', admin, 'Customer phoned to cancel');
    expect(await stock(1)).toMatchObject({ reserved: 0 });
    expect((await pendingCommands(c.device, 0)).map((x) => x.type)).toEqual(['order.accepted', 'order.cancelled']);
  });
});

describe('moving along and handing over', () => {
  it('preparing then ready, by a cashier', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    await move({ id: o.id, version: await version(o.id) }, 'preparing', cashier);
    await move({ id: o.id, version: await version(o.id) }, 'ready_for_pickup', cashier);
    expect((await getOrderForStaff(c.app, admin, o.id)).status).toBe('ready_for_pickup');
  });

  it('only the POS can complete a pickup', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    await move({ id: o.id, version: await version(o.id) }, 'preparing');
    await move({ id: o.id, version: await version(o.id) }, 'ready_for_pickup');
    expect(await code(move({ id: o.id, version: await version(o.id) }, 'completed'))).toBe('409 BAD_TRANSITION');
  });

  it('the POS handover completes the order, marks it paid and uses the stock once', async () => {
    const o = await newOrder();
    await move(o, 'accepted');
    await applyEvents(c.device, { deviceId }, [
      { eventId: `${deviceId}:0:1`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'stock.movement', payload: { movementId: 7, productId: 1, qty: -2000, reason: 'sale', sourceType: 'sale', sourceId: 3, sourceLine: 0, orderId: o.id } },
      { eventId: `${deviceId}:0:2`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'order.handed_over', payload: { orderId: o.id, invoiceNo: 'INV-00000003', saleUuid: '00000000-0000-4000-8000-000000000003', totalIncl: 2300, handedOverAt: '2026-11-10T09:00:00.000Z' } },
    ]);
    const d = await getOrderForStaff(c.app, admin, o.id);
    expect(d).toMatchObject({ status: 'completed', posInvoiceNo: 'INV-00000003', paymentStatus: 'paid' });
    expect(d.history.at(-1)).toMatchObject({ status: 'completed', actor: 'pos' });
    expect(await stock(1)).toEqual({ on_hand: 3000, reserved: 0 });
  });

  it('a handover for an order no longer open is parked, not applied', async () => {
    const o = await newOrder();
    await move(o, 'rejected', admin, 'No');
    await applyEvents(c.device, { deviceId }, [{ eventId: `${deviceId}:0:1`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'order.handed_over', payload: { orderId: o.id, invoiceNo: 'INV-1', saleUuid: '00000000-0000-4000-8000-000000000001', totalIncl: 2300, handedOverAt: '2026-11-10T09:00:00.000Z' } }]);
    expect((await getOrderForStaff(c.app, admin, o.id)).status).toBe('rejected');
    const [p] = await c.owner.query<{ status: string; error: string }>("SELECT status, error FROM commerce.sync_inbox WHERE type = 'order.handed_over'");
    expect(p).toEqual({ status: 'parked', error: 'order not open' });
  });

  it('anything not sold at handover is given back', async () => {
    const o = await newOrder([{ productId: 1, qty: 2000 }, { productId: 2, qty: 1000 }], 2800);
    await move(o, 'accepted');
    await applyEvents(c.device, { deviceId }, [
      { eventId: `${deviceId}:0:1`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'stock.movement', payload: { movementId: 7, productId: 1, qty: -2000, reason: 'sale', sourceType: 'sale', sourceId: 3, sourceLine: 0, orderId: o.id } },
      { eventId: `${deviceId}:0:2`, version: 1, occurredAt: '2026-11-10T09:00:00.000Z', type: 'order.handed_over', payload: { orderId: o.id, invoiceNo: 'INV-3', saleUuid: '00000000-0000-4000-8000-000000000003', totalIncl: 2300, handedOverAt: '2026-11-10T09:00:00.000Z' } },
    ]);
    expect(await stock(2)).toEqual({ on_hand: 10_000, reserved: 0 });
  });
});

describe('POS commands', () => {
  it('are read in order after a position, and acknowledged', async () => {
    const a = await newOrder();
    const b = await newOrder([{ productId: 2, qty: 1000 }], 500);
    await move(a, 'accepted');
    await move(b, 'accepted');
    const all = await pendingCommands(c.device, 0);
    expect(all.map((x) => (x.payload as { orderId: string }).orderId)).toEqual([a.id, b.id]);
    expect((await pendingCommands(c.device, all[0]!.id)).map((x) => x.id)).toEqual([all[1]!.id]);
    await ackCommands(c.device, [all[0]!.id]);
    expect((await pendingCommands(c.device, 0)).map((x) => x.id)).toEqual([all[1]!.id]);
  });
});

describe('order list and summary', () => {
  it('lists orders newest first with the key facts, and filters', async () => {
    const a = await newOrder();
    await newOrder([{ productId: 2, qty: 1000 }], 500);
    await move(a, 'accepted');
    const all = await listOrders(c.app, cashier, { limit: 20 });
    expect(all.total).toBe(2);
    expect(Object.keys(all.items[0]!).sort()).toEqual(['assignedStaff', 'createdAt', 'customerName', 'fulfilment', 'id', 'itemCount', 'location', 'paymentStatus', 'phone', 'publicRef', 'status', 'totalIncl']);
    expect((await listOrders(c.app, cashier, { status: 'accepted', limit: 20 })).items.map((x) => x.publicRef)).toEqual([a.publicRef]);
    expect((await listOrders(c.app, cashier, { q: a.publicRef.slice(0, 4), limit: 20 })).items.map((x) => x.publicRef)).toContain(a.publicRef);
  });

  it('the summary counts what needs action', async () => {
    const a = await newOrder();
    await newOrder([{ productId: 2, qty: 1000 }], 500);
    await move(a, 'accepted');
    expect(await adminSummary(c.app, cashier)).toMatchObject({ counts: { placed: 1, accepted: 1 }, sync: { fresh: true, parked: 0 }, openDiscrepancies: 0 });
  });

  it('needs orders.view', async () => {
    await c.owner.query("DELETE FROM commerce.staff_role_permissions WHERE role = 'cashier' AND permission = 'orders.view'");
    const r = await attemptLogin(c.app, 'cash1', TEST_PASSWORD, '203.0.113.1');
    const weak = (await readSession(c.app, (r as { token: string }).token))!;
    expect(await code(listOrders(c.app, weak, { limit: 20 }))).toBe('403 FORBIDDEN');
  });
});

describe('products for staff', () => {
  it('lists POS fields with stock, and web fields', async () => {
    const r = await listProductsForStaff(c.app, admin, { limit: 20 });
    expect(r.items[0]).toMatchObject({ id: 1, sku: 'SKU-1', name: 'Made up 1', priceIncl: 1150, status: 'published', onHand: 5000, reserved: 0, available: 5000 });
  });

  it('publishing needs products.publish and is audited', async () => {
    expect(await code(setProductStatus(c.app, cashier, 1, 'archived'))).toBe('403 FORBIDDEN');
    await setProductStatus(c.app, admin, 1, 'archived');
    expect((await listProductsForStaff(c.app, admin, { limit: 20 })).items.find((p) => p.id === 1)!.status).toBe('archived');
    expect((await c.owner.query("SELECT 1 FROM commerce.audit_log WHERE action = 'product.status'")).length).toBe(1);
  });

  it('editing the description cannot touch POS fields', async () => {
    await updateProductWeb(c.app, admin, 1, { description: 'Crisp and sweet', featured: true, safetyStock: 1000 });
    const p = (await listProductsForStaff(c.app, admin, { limit: 20 })).items.find((x) => x.id === 1)!;
    expect(p).toMatchObject({ description: 'Crisp and sweet', featured: true, safetyStock: 1000, available: 4000, priceIncl: 1150 });
    expect(await code(updateProductWeb(c.app, admin, 1, { priceIncl: 1 } as never))).toBe('400 INVALID');
  });
});
