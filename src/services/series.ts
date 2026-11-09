import { roundDiv } from '../core/money';
import { addDays, daysApart } from '../core/date-range';
import { nextDay, storeDayStartUtc } from '../core/store-time';
import { DomainError, type Ctx } from './context';
import { periodKpis } from './financials';
import { salesSummary } from './reports';
import { requirePermission } from './users';

// Points for charts, read from the same services as the reports. Read only.
// null means nothing was recorded because the shop had not started yet. A day after that with no sales is a real zero.

export type SeriesUnit = 'hour' | 'day' | 'week' | 'month';

export interface SalesPoint {
  key: string;
  from: string;
  to: string;
  hour: number | null;
  sales: number | null;
  transactions: number | null;
  average: number | null;
  /** The same stretch one step earlier: an hour or day a week before, the week before, the month before. */
  compare: number | null;
}

const firstDay = (ctx: Ctx) => (ctx.db.prepare('SELECT MIN(entry_date) AS d FROM journal_entries').get() as { d: string | null }).d;
const weekStart = (day: string) => addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthEnd = (day: string) => addDays(monthStart(addDays(monthStart(day), 32)), -1);

function byDayMap(ctx: Ctx, userId: number, from: string, to: string) {
  return new Map(salesSummary(ctx, userId, from, to).byDay.map((d) => [d.day, d]));
}

/** The day one calendar month earlier, kept inside that month. */
function monthBefore(day: string): string {
  const prevEnd = addDays(monthStart(day), -1);
  const target = `${prevEnd.slice(0, 8)}${day.slice(8)}`;
  return target > prevEnd || Number.isNaN(Date.parse(target)) ? prevEnd : target;
}

function hourly(ctx: Ctx, day: string): Map<number, { total: number; n: number }> {
  const rows = ctx.db
    .prepare(`SELECT CAST(substr(datetime(created_at, '+180 minutes'), 12, 2) AS INTEGER) AS h, SUM(total_incl) AS total, COUNT(*) AS n FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY h`)
    .all(storeDayStartUtc(day), storeDayStartUtc(nextDay(day))) as { h: number; total: number; n: number }[];
  return new Map(rows.map((r) => [r.h, { total: r.total, n: r.n }]));
}

const avg = (total: number | null, n: number | null) => (total !== null && n ? roundDiv(total, n) : null);

export function salesSeries(ctx: Ctx, userId: number, q: { from: string; to: string; unit: SeriesUnit }): SalesPoint[] {
  requirePermission(ctx, userId, 'reports.view');
  if (q.to < q.from) throw new DomainError('VALIDATION', '"To" date is before "From" date');
  const first = firstDay(ctx);
  if (q.unit === 'hour') {
    if (q.from !== q.to) throw new DomainError('VALIDATION', 'Hours can only be shown for one day');
    const now = hourly(ctx, q.from);
    const earlier = hourly(ctx, addDays(q.from, -7));
    const started = first !== null && q.from >= first;
    if (now.size === 0 && earlier.size === 0) return [];
    const hours = [...now.keys(), ...earlier.keys()];
    const out: SalesPoint[] = [];
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
      const c = now.get(h);
      const sales = started ? (c?.total ?? 0) : null;
      const transactions = started ? (c?.n ?? 0) : null;
      out.push({ key: `${q.from}T${String(h).padStart(2, '0')}`, from: q.from, to: q.from, hour: h, sales, transactions, average: avg(sales, transactions), compare: first !== null && addDays(q.from, -7) >= first ? (earlier.get(h)?.total ?? 0) : null });
    }
    return out;
  }
  const lookback = q.unit === 'month' ? addDays(monthStart(q.from), -31) : addDays(q.from, -14);
  const map = byDayMap(ctx, userId, lookback, q.to);
  const sum = (from: string, to: string) => {
    if (first === null || to < first) return { total: null, n: null };
    let total = 0;
    let n = 0;
    for (let d = from; d <= to; d = nextDay(d)) {
      const x = map.get(d);
      if (x) {
        total += x.totalIncl;
        n += x.saleCount;
      }
    }
    return { total, n };
  };
  const out: SalesPoint[] = [];
  for (let d = q.from; d <= q.to;) {
    let end = d;
    let cf: string;
    let ct: string;
    if (q.unit === 'day') {
      cf = addDays(d, -7);
      ct = cf;
    } else if (q.unit === 'week') {
      end = addDays(weekStart(d), 6);
      if (end > q.to) end = q.to;
      cf = addDays(d, -7);
      ct = addDays(end, -7);
    } else {
      end = monthEnd(d);
      if (end > q.to) end = q.to;
      cf = monthBefore(d);
      ct = monthBefore(end);
    }
    const c = sum(d, end);
    out.push({ key: d, from: d, to: end, hour: null, sales: c.total, transactions: c.n, average: avg(c.total, c.n), compare: sum(cf, ct).total });
    d = nextDay(end);
  }
  return out;
}

export interface SaleRow {
  invoiceNo: string;
  at: string;
  cashier: string;
  customer: string | null;
  total: number;
  discount: number;
  payments: string;
}

/** The sales behind a chart point. Same permission as the reports they sit in. */
export function salesList(ctx: Ctx, userId: number, q: { from: string; to: string; hour?: number }): { rows: SaleRow[]; more: boolean } {
  requirePermission(ctx, userId, 'reports.view');
  const LIMIT = 300;
  const rows = ctx.db
    .prepare(
      `SELECT s.invoice_no AS invoiceNo, s.created_at AS at, u.display_name AS cashier, c.name AS customer, s.total_incl AS total, s.total_discount AS discount,
         (SELECT group_concat(p.tender) FROM payments p WHERE p.sale_id = s.id) AS payments
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.created_at >= ? AND s.created_at < ? ${q.hour === undefined ? '' : "AND CAST(substr(datetime(s.created_at, '+180 minutes'), 12, 2) AS INTEGER) = ?"}
       ORDER BY s.id DESC LIMIT ?`,
    )
    .all(storeDayStartUtc(q.from), storeDayStartUtc(nextDay(q.to)), ...(q.hour === undefined ? [] : [q.hour]), LIMIT + 1) as SaleRow[];
  return { rows: rows.slice(0, LIMIT), more: rows.length > LIMIT };
}

export interface PurchasePoint {
  from: string;
  to: string;
  gross: number | null;
  invoices: number | null;
}

/** Supplier invoices by day, or by month for a long stretch. Read only. */
export function purchaseSeries(ctx: Ctx, userId: number, q: { from: string; to: string }): PurchasePoint[] {
  requirePermission(ctx, userId, 'purchase.view');
  if (q.to < q.from) throw new DomainError('VALIDATION', 'Check the dates');
  const first = firstDay(ctx);
  const rows = new Map((ctx.db.prepare('SELECT invoice_date AS d, SUM(gross) AS gross, COUNT(*) AS n FROM purchase_invoices WHERE invoice_date BETWEEN ? AND ? GROUP BY invoice_date').all(q.from, q.to) as { d: string; gross: number; n: number }[]).map((r) => [r.d, r]));
  const monthly = daysApart(q.from, q.to) > 62;
  const out: PurchasePoint[] = [];
  for (let d = q.from; d <= q.to;) {
    let end = d;
    if (monthly) {
      end = monthEnd(d);
      if (end > q.to) end = q.to;
    }
    if (first === null || end < first) out.push({ from: d, to: end, gross: null, invoices: null });
    else {
      let gross = 0;
      let invoices = 0;
      for (let x = d; x <= end; x = nextDay(x)) {
        gross += rows.get(x)?.gross ?? 0;
        invoices += rows.get(x)?.n ?? 0;
      }
      out.push({ from: d, to: end, gross, invoices });
    }
    d = nextDay(end);
  }
  return out;
}

export interface MovementRow {
  id: number;
  at: string;
  sku: string;
  nameEn: string;
  qty: number;
  reason: string;
  user: string;
}

export interface MovementDay {
  day: string;
  inLines: number | null;
  outLines: number | null;
}

/** Stock movement records, and how many went in or out each day. Quantities of different goods are never added up. */
export function stockMovementLog(ctx: Ctx, userId: number, q: { from: string; to: string }): { days: MovementDay[]; rows: MovementRow[]; more: boolean } {
  requirePermission(ctx, userId, 'reports.view');
  if (q.to < q.from) throw new DomainError('VALIDATION', 'Check the dates');
  const LIMIT = 300;
  const f = storeDayStartUtc(q.from);
  const t = storeDayStartUtc(nextDay(q.to));
  const first = firstDay(ctx);
  const counts = new Map((ctx.db.prepare(`SELECT substr(datetime(at, '+180 minutes'), 1, 10) AS d, SUM(qty > 0) AS i, SUM(qty < 0) AS o FROM stock_movements WHERE at >= ? AND at < ? GROUP BY d`).all(f, t) as { d: string; i: number; o: number }[]).map((r) => [r.d, r]));
  const days: MovementDay[] = [];
  for (let d = q.from; d <= q.to; d = nextDay(d)) days.push(first === null || d < first ? { day: d, inLines: null, outLines: null } : { day: d, inLines: counts.get(d)?.i ?? 0, outLines: counts.get(d)?.o ?? 0 });
  const rows = ctx.db.prepare('SELECT m.id, m.at, p.sku, p.name_en AS nameEn, m.qty, m.reason, u.display_name AS user FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.user_id WHERE m.at >= ? AND m.at < ? ORDER BY m.id DESC LIMIT ?').all(f, t, LIMIT + 1) as MovementRow[];
  return { days, rows: rows.slice(0, LIMIT), more: rows.length > LIMIT };
}

export interface FinancePoint {
  month: string;
  netSales: number | null;
  grossProfit: number | null;
  expenses: number | null;
  netProfit: number | null;
}

/** Month by month, from the same profit and loss as the statements. The newest month runs to `toDay`. */
export function financeSeries(ctx: Ctx, userId: number, toDay: string, months = 12): FinancePoint[] {
  requirePermission(ctx, userId, 'finance.view');
  const first = firstDay(ctx);
  const out: FinancePoint[] = [];
  let end = toDay;
  for (let i = 0; i < months; i++) {
    const from = monthStart(end);
    if (first === null || end < first) out.unshift({ month: from.slice(0, 7), netSales: null, grossProfit: null, expenses: null, netProfit: null });
    else {
      const k = periodKpis(ctx, userId, from, end);
      out.unshift({ month: from.slice(0, 7), netSales: k.netSales, grossProfit: k.grossProfit, expenses: k.operatingExpenses, netProfit: k.netProfit });
    }
    end = addDays(from, -1);
  }
  return out;
}

export const defaultUnit = (from: string, to: string): SeriesUnit => (from === to ? 'hour' : daysApart(from, to) > 62 ? 'week' : 'day');
