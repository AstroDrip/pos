import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDiscrepancy, syncHealth } from '../src/server/admin-core.ts';
import { attemptLogin, readSession, type StaffUser } from '../src/server/auth-core.ts';
import { stockIsFresh } from '../src/server/catalog-core.ts';
import { applyEvents, authenticate, enrollDevice, pendingCommands, reservedTotals } from '../src/server/device-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { placeOrder } from '../src/server/order-core.ts';
import { changeOrderStatus } from '../src/server/admin-core.ts';
import { addCode, addStaff, makeCloud, TEST_PASSWORD, type TestCloud } from './helpers.ts';

let c: TestCloud;
let deviceId: string;
let secret: string;
let admin: StaffUser;
let cashier: StaffUser;
const at = '2026-11-10T09:00:00.000Z';
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));
const id = (seq: number, epoch = 0) => `${deviceId}:${epoch}:${seq}`;
const product = (seq: number, productId = 1, epoch = 0) => ({ eventId: id(seq, epoch), version: 1, occurredAt: at, type: 'catalog.product' as const, payload: { productId, sku: `SKU-${productId}`, nameEn: `Made up ${productId}`, nameAr: '', categoryId: null, unit: 'PCS', sellMode: 'unit' as const, itemKind: 'stock' as const, priceIncl: 1000, vatRateBp: 1500, active: true, barcodes: [] } });
const move = (seq: number, qty: number, productId = 1, epoch = 0, orderId: string | null = null) => ({ eventId: id(seq, epoch), version: 1, occurredAt: at, type: 'stock.movement' as const, payload: { movementId: seq, productId, qty, reason: 'sale' as const, sourceType: 'sale', sourceId: seq, sourceLine: 0, orderId } });
const checkpoint = (seq: number, balances: { productId: number; qty: number }[], epoch = 0, part = 1, parts = 1) => ({ eventId: id(seq, epoch), version: 1, occurredAt: at, type: 'stock.checkpoint' as const, payload: { uptoSeq: seq - 1, part, parts, balances } });
const send = (events: Parameters<typeof applyEvents>[2], pending = 0) => applyEvents(c.device, { deviceId }, events, pending);
const device = async () => (await c.owner.query<{ needs_checkpoint: boolean; epoch: number | string; acked_seq: number | string }>('SELECT needs_checkpoint, epoch, acked_seq FROM commerce.devices WHERE id = $1', [deviceId]))[0]!;
const open = async (kind: string) => c.owner.query<{ id: string; expected: number; actual: number }>("SELECT id, expected, actual FROM commerce.stock_discrepancies WHERE kind = $1 AND state = 'open'", [kind]);

async function login(name: string, role: 'admin' | 'cashier') {
  await addStaff(c, name, role);
  const r = await attemptLogin(c.app, name, TEST_PASSWORD, '203.0.113.1');
  return (await readSession(c.app, (r as { token: string }).token))!;
}

beforeEach(async () => {
  c = await makeCloud();
  await addCode(c, 'made-up-code-e2');
  const d = await enrollDevice(c.device, '203.0.113.2', { code: 'made-up-code-e2', deviceName: 'Made up till' });
  deviceId = d.deviceId;
  secret = d.deviceSecret;
  admin = await login('owner1', 'admin');
  cashier = await login('cash1', 'cashier');
});
afterEach(() => c.pg.close());

describe('when stock can be trusted', () => {
  it('a new POS is not trusted until its first full stock check arrives', async () => {
    expect(await send([product(1)])).toEqual({ ackedSeq: 1, needCheckpoint: true });
    expect(await stockIsFresh(c.app)).toBe(false);
    expect(await send([checkpoint(2, [{ productId: 1, qty: 5000 }])])).toEqual({ ackedSeq: 2, needCheckpoint: false });
    expect(await stockIsFresh(c.app)).toBe(true);
  });

  it('a POS that is in contact but still sending a backlog is not trusted yet', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '5 minutes'");
    await send([move(3, -1000)], 150);
    const [d] = await c.owner.query<{ last_seen_at: Date }>('SELECT last_seen_at FROM commerce.devices');
    expect(Date.now() - new Date(d!.last_seen_at).getTime()).toBeGreaterThan(60_000);
    await send([move(4, -1000)], 0);
    expect(await stockIsFresh(c.app)).toBe(true);
  });

  it('just making contact does not count as being up to date', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '1 hour'");
    await authenticate(c.device, `Bearer ${deviceId}.${secret}`);
    expect(await stockIsFresh(c.app)).toBe(false);
  });

  it('after a long silence the POS must send a full stock check before ordering reopens', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query("UPDATE commerce.devices SET last_seen_at = now() - interval '2 hours'");
    expect(await send([move(3, -1000)])).toEqual({ ackedSeq: 3, needCheckpoint: true });
    expect(await stockIsFresh(c.app)).toBe(false);
    await send([checkpoint(4, [{ productId: 1, qty: 4000 }])]);
    expect(await stockIsFresh(c.app)).toBe(true);
  });

  it('a stock check in several parts only counts when the last part arrives', async () => {
    await send([product(1), product(2, 2)]);
    expect(await send([checkpoint(3, [{ productId: 1, qty: 1000 }], 0, 1, 2)])).toMatchObject({ needCheckpoint: true });
    expect(await send([checkpoint(4, [{ productId: 2, qty: 1000 }], 0, 2, 2)])).toMatchObject({ needCheckpoint: false });
  });
});

describe('a backup restored on the POS', () => {
  async function ready() {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }]), move(3, -1000)]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
  }

  it('a new epoch starts numbering again and needs a full stock check', async () => {
    await ready();
    expect(await send([product(1, 1, 1)])).toEqual({ ackedSeq: 1, needCheckpoint: true });
    expect(await device()).toMatchObject({ epoch: 1, needs_checkpoint: true });
    expect(await stockIsFresh(c.app)).toBe(false);
    await send([checkpoint(2, [{ productId: 1, qty: 4500 }], 1)]);
    expect(await stockIsFresh(c.app)).toBe(true);
    expect(await open('checkpoint')).toEqual([expect.objectContaining({ expected: 4000, actual: 4500 })]);
  });

  it('an old epoch can never be applied again', async () => {
    await ready();
    await send([product(1, 1, 1)]);
    expect(await code(send([move(4, -1000)]))).toBe('409 BAD_EVENT_ID');
  });

  it('orders are sent to the POS again: open ones to hand over, finished ones blocked', async () => {
    await ready();
    const place = async (k: string, phone: string) => {
      const { publicRef } = await placeOrder(c.app, { idempotencyKey: k, accessToken: randomBytes(32).toString('base64url'), fulfilment: 'pickup', customerName: 'Made Up', phone, paymentMethod: 'pay_at_pickup', lines: [{ productId: 1, qty: 1000 }], expectedTotal: 1000 }, '198.51.100.1');
      const [o] = await c.owner.query<{ id: string }>('SELECT id FROM commerce.orders WHERE public_ref = $1', [publicRef]);
      await changeOrderStatus(c.app, admin, { orderId: o!.id, to: 'accepted', version: 1 });
      return o!.id;
    };
    const openOrder = await place('epoch-a-0001', '0511111111');
    const doneOrder = await place('epoch-b-0001', '0522222222');
    await send([move(4, -1000, 1, 0, doneOrder), { eventId: id(5), version: 1, occurredAt: at, type: 'order.handed_over' as const, payload: { orderId: doneOrder, invoiceNo: 'INV-1', saleUuid: '00000000-0000-4000-8000-000000000001', totalIncl: 1000, handedOverAt: at } }]);
    const before = (await pendingCommands(c.device, 0)).length;
    await send([product(1, 1, 1)]);
    const again = (await pendingCommands(c.device, 0)).slice(before);
    expect(again.map((x) => [x.type, (x.payload as { orderId: string }).orderId])).toEqual(expect.arrayContaining([['order.accepted', openOrder], ['order.cancelled', doneOrder]]));
  });
});

describe('problems are flagged, never hidden', () => {
  it('a POS sale that leaves less than is held for online orders is flagged once', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
    await placeOrder(c.app, { idempotencyKey: 'short-0001', accessToken: randomBytes(32).toString('base64url'), fulfilment: 'pickup', customerName: 'Made Up', phone: '0533333333', paymentMethod: 'pay_at_pickup', lines: [{ productId: 1, qty: 3000 }], expectedTotal: 3000 }, '198.51.100.2');
    await send([move(3, -4000)]);
    expect(await open('shortage')).toEqual([expect.objectContaining({ expected: 3000, actual: 1000 })]);
    await send([move(4, -500)]);
    expect(await open('shortage')).toHaveLength(1);
  });

  it('a held total that does not match the holds is flagged at the stock check', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query('UPDATE commerce.inventory_positions SET reserved = 700');
    await send([checkpoint(3, [{ productId: 1, qty: 5000 }])]);
    expect(await open('reservation_sum')).toEqual([expect.objectContaining({ expected: 0, actual: 700 })]);
  });
});

describe('staff sync page', () => {
  it('shows the POS, set-aside messages and open differences', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }]), { ...move(3, 100), version: 2 }]);
    await c.owner.query('UPDATE commerce.inventory_positions SET reserved = 700');
    await send([checkpoint(4, [{ productId: 1, qty: 4000 }])]);
    const h = await syncHealth(c.app, cashier);
    expect(h.devices[0]).toMatchObject({ name: 'Made up till', epoch: 0, needsCheckpoint: false, ackedSeq: 4 });
    expect(h.parked).toEqual([expect.objectContaining({ type: 'stock.movement', error: 'unknown version' })]);
    expect(h.discrepancies.map((d) => d.kind).sort()).toEqual(['checkpoint', 'reservation_sum']);
  });

  it('only stock.override can mark a difference resolved, and it is audited', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }]), checkpoint(3, [{ productId: 1, qty: 4000 }])]);
    const [d] = await open('checkpoint');
    expect(await code(resolveDiscrepancy(c.app, cashier, d!.id))).toBe('403 FORBIDDEN');
    await resolveDiscrepancy(c.app, admin, d!.id);
    expect(await open('checkpoint')).toEqual([]);
    expect((await c.owner.query("SELECT 1 FROM commerce.audit_log WHERE action = 'stock.resolve'")).length).toBe(1);
  });
});

describe('held totals for the POS', () => {
  it('lists what is held online for each product', async () => {
    await send([product(1), checkpoint(2, [{ productId: 1, qty: 5000 }])]);
    await c.owner.query("UPDATE commerce.web_products SET status = 'published'");
    await placeOrder(c.app, { idempotencyKey: 'held-0001', accessToken: randomBytes(32).toString('base64url'), fulfilment: 'pickup', customerName: 'Made Up', phone: '0544444444', paymentMethod: 'pay_at_pickup', lines: [{ productId: 1, qty: 2000 }], expectedTotal: 2000 }, '198.51.100.3');
    expect(await reservedTotals(c.device)).toEqual([{ productId: 1, reserved: 2000 }]);
  });
});
