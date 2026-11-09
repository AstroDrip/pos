import { createHash } from 'node:crypto';
import { nextDay, storeDay, storeDayStartUtc } from '../core/store-time';
import type { Ctx } from './context';
import { openCreditInvoicesAll } from './credit';
import { ownerKpis, periodKpis } from './financials';
import { ageBucket } from '../core/status';
import { supplierAgeingAll } from './purchasing';
import { openShiftId, shiftSummary } from './shifts';
import { vatPendingBetween } from './vat-review';

// Owner dashboard sync (ADR-6). The POS stays the only writer. Read-only snapshots go into a transactional
// outbox in the same SQLite file; a sender uploads them and marks a row "sent" ONLY when the server confirms
// its event id. Snapshots are idempotent: the server keeps the highest version per (kind, snapKey).
//
// The remote service lives in dashboard/. The Windows app sends through cloud-client.ts. Tests use a fake transport.

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

const BATCH = 25;

export function dashboardEnabled(ctx: Ctx): boolean {
  return (ctx.db.prepare("SELECT value FROM settings WHERE key = 'dashboard_enabled'").get() as { value: string } | undefined)?.value === '1';
}

const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const SYNC_LOOKBACK_DAYS = 35;
export const SYNC_FULL_HISTORY_DAYS = 730;

/** One business day, from the same services the desktop reports use. A day with no sales reports real zeros. */
function daySnapshot(ctx: Ctx, day: string) {
  const k = periodKpis(ctx, null, day, day);
  const f = storeDayStartUtc(day);
  const t = storeDayStartUtc(nextDay(day));
  const onAccount = (ctx.db.prepare("SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.tender = 'account' AND s.created_at >= ? AND s.created_at < ?").get(f, t) as { v: number }).v;
  const credit = ctx.db
    .prepare(`SELECT COALESCE(SUM(i.gross - COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.invoice_id = i.id AND a.kind = 'at_payment'), 0)), 0) AS v FROM purchase_invoices i WHERE i.invoice_date = ?`)
    .get(day) as { v: number };
  const byCategory = ctx.db
    .prepare(`SELECT COALESCE(c.name_en, 'No category') AS name, SUM(l.line_excl) AS net, SUM(l.qty) AS qty FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN products p ON p.id = l.product_id LEFT JOIN categories c ON c.id = p.category_id
              WHERE s.created_at >= ? AND s.created_at < ? GROUP BY c.id ORDER BY net DESC LIMIT 200`)
    .all(f, t) as { name: string; net: number; qty: number }[];
  const byProduct = ctx.db
    .prepare(`SELECT p.sku, p.name_en AS name, SUM(l.qty) AS qty, SUM(l.line_excl) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN products p ON p.id = l.product_id
              WHERE s.created_at >= ? AND s.created_at < ? GROUP BY p.id ORDER BY net DESC LIMIT 400`)
    .all(f, t) as { sku: string; name: string; qty: number; net: number }[];
  return {
    day, salesInclVat: k.salesInclVat, transactions: k.saleCount, netSales: k.netSales, returns: k.pl.returns, discounts: k.pl.discountsGiven, cogs: k.cogs, grossProfit: k.grossProfit, operatingExpenses: k.operatingExpenses, netProfit: k.netProfit,
    outputVat: k.pl.outputVat, inputVat: k.pl.inputVat, cash: k.cashCollected, card: k.cardRecorded, onAccount, supplierCreditPurchases: credit.v,
    expenses: k.pl.operating.map((e) => ({ code: e.code, name: e.nameEn, amount: e.amount })), byCategory, byProduct, provisional: true,
  };
}

function latestIntegrityCounts(ctx: Ctx) {
  const run = ctx.db.prepare('SELECT id, at FROM integrity_runs ORDER BY id DESC LIMIT 1').get() as { id: number; at: string } | undefined;
  if (!run) return null;
  const n = (s: string) => (ctx.db.prepare('SELECT count(*) AS n FROM integrity_findings WHERE run_id = ? AND severity = ?').get(run.id, s) as { n: number }).n;
  return { checkedAt: run.at, critical: n('critical'), warnings: n('warning') };
}

function positionSnapshot(ctx: Ctx, today: string, fromDay: string) {
  const now = ownerKpis(ctx, null, today, today);
  const range = periodKpis(ctx, null, fromDay, today);
  return {
    asOf: now.generatedAt, inventoryValue: now.inventoryValue, cashAndBank: now.cashAndBank, receivablesOutstanding: now.receivablesOutstanding, receivablesOverdue: now.receivablesOverdue, customersWithBalance: now.customersWithBalance, customerAdvances: now.customerAdvances,
    payablesOutstanding: now.payablesOutstanding, payablesOverdue: now.payablesOverdue, suppliersWithBalance: now.suppliersWithBalance, supplierAdvances: now.supplierAdvances, expensesOutstanding: now.expensesOutstanding,
    prepaidWaiting: range.pl.prepaidWaiting, vatPending: vatPendingBetween(ctx, '2000-01-01', today), provisionalReasons: range.pl.provisionalReasons,
    reconcile: { fromDay, toDay: today, salesInclVat: range.salesInclVat, transactions: range.saleCount, netProfit: range.netProfit },
    integrity: latestIntegrityCounts(ctx),
  };
}

function stockSnapshot(ctx: Ctx) {
  const rows = ctx.db
    .prepare(`SELECT p.sku, p.name_en AS name, COALESCE(b.qty,0) AS qty, p.reorder_level AS reorderLevel FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id WHERE p.active = 1 ORDER BY qty - p.reorder_level`)
    .all() as { sku: string; name: string; qty: number; reorderLevel: number }[];
  const out = rows.filter((r) => r.qty <= 0);
  const low = rows.filter((r) => r.qty > 0 && r.qty <= r.reorderLevel);
  const since = new Date(Date.parse(ctx.now()) - 30 * 86_400_000).toISOString();
  const movements = ctx.db.prepare('SELECT reason, COUNT(*) AS lines, SUM(qty) AS qty FROM stock_movements WHERE at >= ? GROUP BY reason ORDER BY reason').all(since) as { reason: string; lines: number; qty: number }[];
  return { asOf: ctx.now(), products: rows.length, inStock: rows.filter((r) => r.qty > 0).length, lowStockCount: low.length, outOfStockCount: out.length, lowStock: low.slice(0, 100), outOfStock: out.slice(0, 100), movements, movementDays: 30 };
}

function creditSnapshot(ctx: Ctx, today: string) {
  const invoices = openCreditInvoicesAll(ctx);
  const names = new Map((ctx.db.prepare('SELECT id, name FROM customers').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
  const byCustomer = new Map<number, { name: string; balance: number; overdue: number }>();
  const customerAgeing = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
  for (const i of invoices) {
    const c = byCustomer.get(i.customerId) ?? { name: names.get(i.customerId) ?? '', balance: 0, overdue: 0 };
    c.balance += i.open;
    if (i.dueDate !== null && i.dueDate < today) c.overdue += i.open;
    byCustomer.set(i.customerId, c);
    const b = ageBucket(i.dueDate, today);
    if (b === 'noDue' || b === 'notDue') customerAgeing.current += i.open;
    else customerAgeing[b === 'd1_30' ? 'd1to30' : b === 'd31_60' ? 'd31to60' : b === 'd61_90' ? 'd61to90' : 'over90'] += i.open;
  }
  const sup = supplierAgeingAll(ctx, today);
  const supplierAgeing = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
  for (const s of sup) {
    supplierAgeing.current += s.noDue + s.notDue;
    supplierAgeing.d1to30 += s.d1_30;
    supplierAgeing.d31to60 += s.d31_60;
    supplierAgeing.d61to90 += s.d61_90;
    supplierAgeing.over90 += s.over90;
  }
  return {
    asOf: ctx.now(),
    customers: [...byCustomer.values()].sort((a, b) => b.balance - a.balance).slice(0, 100),
    suppliers: sup.filter((s) => s.balance !== 0).map((s) => ({ name: s.supplier, balance: s.balance, overdue: s.d1_30 + s.d31_60 + s.d61_90 + s.over90 })).sort((a, b) => b.balance - a.balance).slice(0, 100),
    customerAgeing, supplierAgeing,
  };
}

function shiftSnapshot(ctx: Ctx) {
  const id = openShiftId(ctx);
  if (id === null) return { open: false as const };
  const s = shiftSummary(ctx, id);
  const r = ctx.db.prepare('SELECT u.display_name AS cashier, x.opened_at AS openedAt FROM register_shifts x JOIN users u ON u.id = x.user_id WHERE x.id = ?').get(id) as { cashier: string; openedAt: string };
  return { open: true as const, cashier: r.cashier, openedAt: r.openedAt, openingFloat: s.openingFloat, expectedCash: s.expectedCash };
}

/** The read-only figures the owner's phone shows. Every number comes from the same services as the desktop. */
export function buildSnapshots(ctx: Ctx, lookbackDays = SYNC_LOOKBACK_DAYS): { kind: string; snapKey: string; payload: unknown }[] {
  const today = storeDay(ctx.now());
  // Nothing is sent for days before the shop's first record: the dashboard shows those as missing, not as zero.
  const first = ctx.db.prepare('SELECT MIN(entry_date) AS d FROM journal_entries').get() as { d: string | null };
  const window = shiftDay(today, -(lookbackDays - 1));
  const from = first.d === null || first.d > today ? today : first.d > window ? first.d : window;
  const out: { kind: string; snapKey: string; payload: unknown }[] = [];
  for (let d = from; d <= today; d = shiftDay(d, 1)) out.push({ kind: 'day', snapKey: d, payload: daySnapshot(ctx, d) });
  const recent = shiftDay(today, -(SYNC_LOOKBACK_DAYS - 1));
  out.push({ kind: 'position', snapKey: 'current', payload: positionSnapshot(ctx, today, from > recent ? from : recent) });
  out.push({ kind: 'stock', snapKey: 'current', payload: stockSnapshot(ctx) });
  out.push({ kind: 'credit', snapKey: 'current', payload: creditSnapshot(ctx, today) });
  out.push({ kind: 'shift', snapKey: 'current', payload: shiftSnapshot(ctx) });
  return out;
}

const hashOf = (payload: unknown) => {
  // These change every call and are not a change in the figures.
  const clean = JSON.stringify(payload, (k, v: unknown) => (k === 'generatedAt' || k === 'asOf' ? undefined : v));
  return createHash('sha256').update(clean).digest('hex');
};

// Nothing changed since the last round means there is no reason to recompute the figures.
const lastSignature = new WeakMap<object, string>();
const signature = (ctx: Ctx) => {
  const r = ctx.db.prepare('SELECT (SELECT MAX(id) FROM audit_log) AS a, (SELECT MAX(id) FROM journal_entries) AS j, (SELECT MAX(id) FROM stock_movements) AS m').get() as { a: number | null; j: number | null; m: number | null };
  return `${r.a}|${r.j}|${r.m}|${storeDay(ctx.now())}`;
};

/** Adds a new outbox row for every snapshot whose figures changed. Returns how many were queued. */
export function enqueueSnapshots(ctx: Ctx, lookbackDays = SYNC_LOOKBACK_DAYS): number {
  if (!dashboardEnabled(ctx)) return 0;
  const sig = signature(ctx);
  if (lookbackDays === SYNC_LOOKBACK_DAYS && lastSignature.get(ctx.db) === sig) return 0; // a full history pass always looks
  const snaps = buildSnapshots(ctx, lookbackDays);
  let queued = 0;
  ctx.db.transaction(() => {
    for (const s of snaps) {
      const hash = hashOf(s.payload);
      const last = ctx.db.prepare('SELECT version, hash FROM sync_outbox WHERE kind = ? AND snap_key = ? ORDER BY version DESC LIMIT 1').get(s.kind, s.snapKey) as
        | { version: number; hash: string }
        | undefined;
      if (last?.hash === hash) continue;
      // Tied to the clock as well, so that after a restore from an older backup new figures still outrank what the cloud holds.
      const version = Math.max((last?.version ?? 0) + 1, Math.floor(Date.parse(ctx.now()) / 1000) - 1_600_000_000);
      ctx.db
        .prepare('INSERT INTO sync_outbox (event_id, kind, snap_key, version, payload, hash, created_at, next_try_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.uuid(), s.kind, s.snapKey, version, JSON.stringify(s.payload), hash, ctx.now(), ctx.now());
      queued++;
    }
  })();
  lastSignature.set(ctx.db, sig);
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

/** Keeps the outbox small: older confirmed versions go, and the newest of each record stays, so unchanged figures are not re-sent. */
export function compactOutbox(ctx: Ctx, days = 3): number {
  const cutoff = new Date(Date.parse(ctx.now()) - days * 86_400_000).toISOString();
  return ctx.db.prepare("DELETE FROM sync_outbox WHERE status = 'sent' AND sent_at < ? AND id NOT IN (SELECT MAX(id) FROM sync_outbox GROUP BY kind, snap_key)").run(cutoff).changes;
}

/** Removes confirmed events older than `days` (pending ones are never removed). */
export function pruneSent(ctx: Ctx, days = 30): number {
  const cutoff = new Date(Date.parse(ctx.now()) - days * 86_400_000).toISOString();
  return ctx.db.prepare("DELETE FROM sync_outbox WHERE status = 'sent' AND sent_at < ?").run(cutoff).changes;
}
