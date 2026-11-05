import { createHash } from 'node:crypto';
import { storeDay } from '../core/store-time';
import type { Ctx } from './context';
import { ownerKpis } from './financials';
import { openShiftId, shiftSummary } from './shifts';

// Owner dashboard sync (ADR-6). The POS stays the only writer. Read-only snapshots go into a transactional
// outbox in the same SQLite file; a sender uploads them and marks a row "sent" ONLY when the server confirms
// its event id. Snapshots are idempotent: the server keeps the highest version per (kind, snapKey).
//
// The remote dashboard service is NOT built (owner decision on hosting and cost). Tests use a fake transport.

export interface OutboxEvent {
  eventId: string;
  kind: string;
  snapKey: string;
  version: number;
  createdAt: string;
  payload: unknown;
}

export interface Transport {
  /** Uploads events. Resolves with the event ids the server has durably stored. Rejects on network errors. */
  send(events: OutboxEvent[]): Promise<{ acceptedIds: string[] }>;
}

export const STALE_AFTER_MS = 30 * 60_000;
const BATCH = 50;

export function dashboardEnabled(ctx: Ctx): boolean {
  return (ctx.db.prepare("SELECT value FROM settings WHERE key = 'dashboard_enabled'").get() as { value: string } | undefined)?.value === '1';
}

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const prevMonth = (day: string) => {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCDate(0); // last day of the previous month
  return { from: monthStart(d.toISOString().slice(0, 10)), to: d.toISOString().slice(0, 10) };
};

/** The read-only figures the owner's phone shows. Every number comes from the same services as the desktop. */
export function buildSnapshots(ctx: Ctx): { kind: string; snapKey: string; payload: unknown }[] {
  const today = storeDay(ctx.now());
  const yesterday = shiftDay(today, -1);
  const pm = prevMonth(today);
  const shiftId = openShiftId(ctx);
  // Period figures (sales, profit…) and "right now" figures (stock value, money owed) are kept apart, so a
  // past day's snapshot never changes because of something that happened today.
  const period = (from: string, to: string) => {
    const k: Partial<ReturnType<typeof ownerKpis>> = { ...ownerKpis(ctx, null, from, to) };
    delete k.inventoryValue;
    delete k.expensesOutstanding;
    delete k.lowStockCount;
    return k;
  };
  const now = ownerKpis(ctx, null, today, today);
  return [
    { kind: 'kpis_day', snapKey: today, payload: period(today, today) },
    { kind: 'kpis_day', snapKey: yesterday, payload: period(yesterday, yesterday) },
    { kind: 'kpis_month', snapKey: today.slice(0, 7), payload: period(monthStart(today), today) },
    { kind: 'kpis_month', snapKey: pm.from.slice(0, 7), payload: period(pm.from, pm.to) },
    { kind: 'position', snapKey: 'current', payload: { inventoryValue: now.inventoryValue, expensesOutstanding: now.expensesOutstanding, lowStockCount: now.lowStockCount, asOf: now.generatedAt } },
    { kind: 'shift', snapKey: 'current', payload: shiftId === null ? { open: false } : { open: true, ...shiftSummary(ctx, shiftId) } },
    {
      kind: 'low_stock',
      snapKey: 'current',
      payload: ctx.db
        .prepare(`SELECT p.sku, p.name_en AS nameEn, p.name_ar AS nameAr, COALESCE(b.qty,0) AS qty, p.reorder_level AS reorderLevel
                  FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id
                  WHERE p.active = 1 AND COALESCE(b.qty,0) <= p.reorder_level ORDER BY qty - p.reorder_level LIMIT 50`)
        .all(),
    },
    {
      kind: 'activity',
      snapKey: 'current',
      payload: {
        sales: ctx.db.prepare('SELECT invoice_no AS invoiceNo, total_incl AS total, created_at AS at FROM sales ORDER BY id DESC LIMIT 10').all(),
        refunds: ctx.db.prepare('SELECT refund_no AS refundNo, total_incl AS total, reason, created_at AS at FROM refunds ORDER BY id DESC LIMIT 10').all(),
        expenses: ctx.db.prepare("SELECT expense_no AS expenseNo, description, gross, status, expense_date AS date FROM expenses WHERE status IN ('posted','draft') ORDER BY id DESC LIMIT 10").all(),
        adjustments: ctx.db.prepare('SELECT adj_no AS adjNo, kind, reason, total_value AS value, created_at AS at FROM stock_adjustments ORDER BY id DESC LIMIT 10').all(),
      },
    },
  ];
}

const hashOf = (payload: unknown) => {
  // generatedAt changes every call; it is not a change in the figures.
  const clean = JSON.stringify(payload, (k, v: unknown) => (k === 'generatedAt' ? undefined : v));
  return createHash('sha256').update(clean).digest('hex');
};

/** Adds a new outbox row for every snapshot whose figures changed. Returns how many were queued. */
export function enqueueSnapshots(ctx: Ctx): number {
  if (!dashboardEnabled(ctx)) return 0;
  const snaps = buildSnapshots(ctx);
  let queued = 0;
  ctx.db.transaction(() => {
    for (const s of snaps) {
      const hash = hashOf(s.payload);
      const last = ctx.db.prepare('SELECT version, hash FROM sync_outbox WHERE kind = ? AND snap_key = ? ORDER BY version DESC LIMIT 1').get(s.kind, s.snapKey) as
        | { version: number; hash: string }
        | undefined;
      if (last?.hash === hash) continue;
      ctx.db
        .prepare('INSERT INTO sync_outbox (event_id, kind, snap_key, version, payload, hash, created_at, next_try_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.uuid(), s.kind, s.snapKey, (last?.version ?? 0) + 1, JSON.stringify(s.payload), hash, ctx.now(), ctx.now());
      queued++;
    }
  })();
  return queued;
}

/**
 * Sends due pending events, oldest first. Marks "sent" only the ids the server confirmed. On failure, backs off
 * (1 min doubling to 1 h) and keeps the events; nothing is ever lost or marked sent without confirmation.
 */
export async function syncOnce(ctx: Ctx, transport: Transport): Promise<{ sent: number; failed: boolean }> {
  const now = ctx.now();
  const rows = ctx.db
    .prepare("SELECT id, event_id, kind, snap_key, version, payload, created_at, attempts FROM sync_outbox WHERE status = 'pending' AND next_try_at <= ? ORDER BY id LIMIT ?")
    .all(now, BATCH) as { id: number; event_id: string; kind: string; snap_key: string; version: number; payload: string; created_at: string; attempts: number }[];
  if (rows.length === 0) return { sent: 0, failed: false };
  ctx.db.prepare('UPDATE sync_state SET last_attempt_at = ? WHERE id = 1').run(now);
  try {
    const res = await transport.send(rows.map((r) => ({ eventId: r.event_id, kind: r.kind, snapKey: r.snap_key, version: r.version, createdAt: r.created_at, payload: JSON.parse(r.payload) as unknown })));
    const accepted = new Set(res.acceptedIds);
    const done = ctx.db.prepare("UPDATE sync_outbox SET status = 'sent', sent_at = ?, last_error = NULL WHERE event_id = ? AND status = 'pending'");
    let sent = 0;
    ctx.db.transaction(() => {
      for (const r of rows) if (accepted.has(r.event_id)) sent += done.run(ctx.now(), r.event_id).changes;
      const missing = rows.filter((r) => !accepted.has(r.event_id));
      for (const r of missing) backoff(ctx, r.id, r.attempts, 'Not confirmed by the server');
      ctx.db.prepare('UPDATE sync_state SET last_success_at = ?, last_error = ? WHERE id = 1').run(ctx.now(), missing.length ? `${missing.length} event(s) not confirmed` : null);
    })();
    return { sent, failed: false };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    ctx.db.transaction(() => {
      for (const r of rows) backoff(ctx, r.id, r.attempts, msg);
      ctx.db.prepare('UPDATE sync_state SET last_error = ? WHERE id = 1').run(msg);
    })();
    return { sent: 0, failed: true };
  }
}

function backoff(ctx: Ctx, id: number, attempts: number, error: string) {
  const delay = Math.min(60_000 * 2 ** attempts, 3_600_000);
  ctx.db.prepare('UPDATE sync_outbox SET attempts = attempts + 1, next_try_at = ?, last_error = ? WHERE id = ?').run(new Date(Date.parse(ctx.now()) + delay).toISOString(), error, id);
}

export interface SyncHealth {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  pending: number;
  /** True when the phone's figures may be out of date (no confirmed upload for 30 minutes, or never). */
  stale: boolean;
}

export function syncHealth(ctx: Ctx): SyncHealth {
  const s = ctx.db.prepare('SELECT last_success_at, last_error FROM sync_state WHERE id = 1').get() as { last_success_at: string | null; last_error: string | null };
  const pending = (ctx.db.prepare("SELECT count(*) AS n FROM sync_outbox WHERE status = 'pending'").get() as { n: number }).n;
  const stale = s.last_success_at === null || Date.parse(ctx.now()) - Date.parse(s.last_success_at) > STALE_AFTER_MS || pending > 0;
  return { enabled: dashboardEnabled(ctx), lastSuccessAt: s.last_success_at, lastError: s.last_error, pending, stale };
}

/** Removes confirmed events older than `days` (pending ones are never removed). */
export function pruneSent(ctx: Ctx, days = 30): number {
  const cutoff = new Date(Date.parse(ctx.now()) - days * 86_400_000).toISOString();
  return ctx.db.prepare("DELETE FROM sync_outbox WHERE status = 'sent' AND sent_at < ?").run(cutoff).changes;
}
