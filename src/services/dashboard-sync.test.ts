// Owner dashboard outbox and sync (ADR-6). SIMULATED: a fake in-memory server stands in for the dashboard
// service, which is not built yet. These tests prove the POS side: nothing lost, nothing duplicated, honest staleness.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { enqueueSnapshots, pruneSent, syncHealth, syncOnce, type OutboxEvent, type Transport } from './dashboard-sync';
import { ownerKpis } from './financials';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let milk: number;
let k = 0;
const key = () => `dash-key-${++k}-xxx`;

/** Fake dashboard server: stores by event id (de-duplicates) and keeps the newest version per (kind, snapKey). */
class FakeServer implements Transport {
  stored = new Map<string, OutboxEvent>();
  latest = new Map<string, OutboxEvent>();
  calls = 0;
  mode: 'ok' | 'down' | 'loseReply' | 'partial' = 'ok';
  async send(events: OutboxEvent[]) {
    this.calls++;
    if (this.mode === 'down') throw new Error('ECONNREFUSED');
    const accepted = this.mode === 'partial' ? events.slice(0, 1) : events;
    for (const e of accepted) {
      this.stored.set(e.eventId, e);
      const kk = `${e.kind}/${e.snapKey}`;
      if ((this.latest.get(kk)?.version ?? 0) < e.version) this.latest.set(kk, e);
    }
    if (this.mode === 'loseReply') throw new Error('timeout'); // stored, but the POS never heard back
    return { acceptedIds: accepted.map((e) => e.eventId) };
  }
}

const enable = () => ctx.db.prepare("UPDATE settings SET value = '1' WHERE key = 'dashboard_enabled'").run();
const pending = () => (ctx.db.prepare("SELECT count(*) AS n FROM sync_outbox WHERE status = 'pending'").get() as { n: number }).n;
const sell = () => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: milk, qty: 1000 }], payments: [{ tender: 'cash', amount: 650 }] });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  milk = createProduct(ctx, u.admin, { sku: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 650 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'S' }), lines: [{ productId: milk, qty: 50_000, unitCost: 400 }] });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('dashboard outbox (simulated server)', () => {
  it('does nothing until the dashboard is set up', () => {
    expect(enqueueSnapshots(ctx)).toBe(0);
    expect(syncHealth(ctx)).toMatchObject({ enabled: false, pending: 0, stale: true, lastSuccessAt: null });
  });

  it('queues only changed snapshots; a sale creates new versions of the affected figures', () => {
    enable();
    expect(enqueueSnapshots(ctx)).toBe(8);
    expect(enqueueSnapshots(ctx)).toBe(0);
    sell();
    // today, this month, shift, activity and stock position change; yesterday, last month and low stock do not
    expect(enqueueSnapshots(ctx)).toBe(5);
  });

  it('uploads, confirms, and the phone figures equal the desktop figures', async () => {
    enable();
    sell();
    enqueueSnapshots(ctx);
    const server = new FakeServer();
    expect(await syncOnce(ctx, server)).toEqual({ sent: 8, failed: false });
    expect(pending()).toBe(0);
    const phone = server.latest.get('kpis_day/2026-11-05')!.payload as Record<string, unknown>;
    const desktop = ownerKpis(ctx, u.admin, '2026-11-05', '2026-11-05') as unknown as Record<string, unknown>;
    for (const f of ['saleCount', 'salesInclVat', 'netSales', 'cogs', 'grossProfit', 'operatingExpenses', 'netProfit', 'cashCollected', 'cardRecorded']) {
      expect([f, phone[f]]).toEqual([f, desktop[f]]);
    }
    expect((server.latest.get('position/current')!.payload as { inventoryValue: number }).inventoryValue).toBe(desktop.inventoryValue);
    expect(syncHealth(ctx)).toMatchObject({ lastSuccessAt: '2026-11-05T08:00:00.000Z', pending: 0, stale: false, lastError: null });
  });

  it('offline: nothing is lost, retries back off, and everything arrives after reconnecting', async () => {
    enable();
    enqueueSnapshots(ctx);
    const server = new FakeServer();
    server.mode = 'down';
    expect(await syncOnce(ctx, server)).toEqual({ sent: 0, failed: true });
    expect(pending()).toBe(8);
    expect(syncHealth(ctx)).toMatchObject({ lastError: 'ECONNREFUSED', stale: true });
    expect(await syncOnce(ctx, server)).toEqual({ sent: 0, failed: false }); // backing off: not due yet
    expect(server.calls).toBe(1);
    sell(); // keep selling offline
    enqueueSnapshots(ctx);
    server.mode = 'ok';
    t.advance(61_000);
    await syncOnce(ctx, server);
    await syncOnce(ctx, server);
    expect(pending()).toBe(0);
    expect((server.latest.get('kpis_day/2026-11-05')!.payload as { saleCount: number }).saleCount).toBe(1);
  });

  it('a lost reply causes a resend, and the server de-duplicates it (no double counting)', async () => {
    enable();
    enqueueSnapshots(ctx);
    const server = new FakeServer();
    server.mode = 'loseReply';
    await syncOnce(ctx, server);
    expect(pending()).toBe(8); // not confirmed, so not marked sent
    server.mode = 'ok';
    t.advance(61_000);
    await syncOnce(ctx, server);
    expect(pending()).toBe(0);
    expect(server.stored.size).toBe(8); // same event ids twice -> stored once
  });

  it('only events the server confirms are marked sent', async () => {
    enable();
    enqueueSnapshots(ctx);
    const server = new FakeServer();
    server.mode = 'partial';
    expect((await syncOnce(ctx, server)).sent).toBe(1);
    expect(pending()).toBe(7);
  });

  it('survives an app restart; pending events are still there', async () => {
    enable();
    enqueueSnapshots(ctx);
    ctx.db.close();
    const db2 = openDatabase(t.path);
    expect((db2.prepare("SELECT count(*) AS n FROM sync_outbox WHERE status = 'pending'").get() as { n: number }).n).toBe(8);
    db2.close();
  });

  it('marks figures stale after 30 minutes without a confirmed upload; old sent events are pruned', async () => {
    enable();
    enqueueSnapshots(ctx);
    await syncOnce(ctx, new FakeServer());
    expect(syncHealth(ctx).stale).toBe(false);
    t.advance(31 * 60_000);
    expect(syncHealth(ctx).stale).toBe(true);
    t.advance(31 * 86_400_000);
    expect(pruneSent(ctx)).toBe(8);
  });
});
