/**
 * Product demand for search ranking: how often each product was bought recently, from completed sales only.
 *
 * - Unit counted: distinct sales containing the product (not units: kilograms and pieces cannot be compared).
 * - Refunds subtract the refunded share of that sale (refunded qty / sold qty, at most 1 per sale).
 * - Score = 0.5 * n7/7 + 0.3 * n30/30 + 0.2 * n90/90 (net sales per day, recent days weigh more).
 * - Products with fewer than DEMAND_MIN_SALES net sales in 90 days get no score (neutral, not a penalty).
 *
 * The score is only used to order products inside the same search match level; it never moves money or stock.
 */
import type Database from 'better-sqlite3';
import type { Ctx } from './context';

export const DEMAND_MIN_SALES = 3;
const DAY_MS = 86_400_000;
const WINDOWS = [
  { days: 7, weight: 0.5 },
  { days: 30, weight: 0.3 },
  { days: 90, weight: 0.2 },
] as const;

interface CacheEntry {
  /** Window start times (ISO) the counts were last brought up to date with: 7, 30 and 90 days back. */
  bounds: [string, string, string];
  lastSaleId: number;
  lastRefundId: number;
  /** productId -> net sales in the 7, 30 and 90-day windows */
  counts: Map<number, [number, number, number]>;
  map: Map<number, number>;
}
let cache = new WeakMap<Database.Database, CacheEntry>();

/** Tests only: forget every cached score. */
export function resetDemandCache(): void {
  cache = new WeakMap();
}

// New sales (id above the last one counted), per product, per window.
const SALES_SQL = `SELECT l.product_id AS p,
         COUNT(DISTINCT CASE WHEN s.created_at >= @d7 THEN s.id END) AS c7,
         COUNT(DISTINCT CASE WHEN s.created_at >= @d30 THEN s.id END) AS c30,
         COUNT(DISTINCT s.id) AS c90
    FROM sales s JOIN sale_lines l ON l.sale_id = s.id
   WHERE s.created_at >= @d90 AND s.id > @after
   GROUP BY l.product_id`;
// Refunded share of a sale: refunded qty / sold qty of that product on that sale (refunds never exceed the sale).
const SHARE = `SUM(rl.qty) * 1.0 / (SELECT SUM(x.qty) FROM sale_lines x WHERE x.sale_id = s.id AND x.product_id = rl.product_id)`;
const REFUNDS_SQL = `SELECT rl.product_id AS p, s.created_at AS at, ${SHARE} AS share
    FROM refunds r JOIN refund_lines rl ON rl.refund_id = r.id JOIN sales s ON s.id = r.original_sale_id
   WHERE s.created_at >= @d90 AND r.id > @after
   GROUP BY r.id, rl.product_id`;
// Already-counted sales whose date has just slipped out of a window.
const LEAVING_SALES_SQL = `SELECT l.product_id AS p, COUNT(DISTINCT s.id) AS c
    FROM sales s JOIN sale_lines l ON l.sale_id = s.id
   WHERE s.created_at >= @from AND s.created_at < @to AND s.id <= @maxSale
   GROUP BY l.product_id`;
const LEAVING_REFUNDS_SQL = `SELECT rl.product_id AS p, ${SHARE} AS share
    FROM refunds r JOIN refund_lines rl ON rl.refund_id = r.id JOIN sales s ON s.id = r.original_sale_id
   WHERE s.created_at >= @from AND s.created_at < @to AND r.id <= @maxRefund
   GROUP BY r.id, rl.product_id`;

/**
 * Scores by product id. The first call per database reads 90 days of sales; later calls only read what changed:
 * new sales and refunds, and sales whose date slipped out of a window since the last call (cheap range scans).
 */
export function demandScores(ctx: Ctx, now: Date = new Date(ctx.now())): Map<number, number> {
  const ids = ctx.db
    .prepare('SELECT (SELECT COALESCE(MAX(id), 0) FROM sales) AS s, (SELECT COALESCE(MAX(id), 0) FROM refunds) AS r')
    .get() as { s: number; r: number };
  const t = now.getTime();
  const bounds = WINDOWS.map((w) => new Date(t - w.days * DAY_MS).toISOString()) as [string, string, string];
  let entry = cache.get(ctx.db);
  if (entry && entry.lastSaleId === ids.s && entry.lastRefundId === ids.r && entry.bounds.every((b, i) => b === bounds[i])) return entry.map;
  const fresh = !entry || entry.bounds.some((b, i) => b > bounds[i]!); // clock moved back: start over
  if (fresh) entry = { bounds, lastSaleId: 0, lastRefundId: 0, counts: new Map(), map: new Map() };
  const e = entry!;
  const bump = (p: number, i: number, by: number) => {
    const c = e.counts.get(p) ?? [0, 0, 0];
    c[i as 0 | 1 | 2] += by;
    e.counts.set(p, c);
  };

  // 1. Age: counted sales that left a window take their (net) sale out of that window.
  if (!fresh) {
    for (let i = 0; i < WINDOWS.length; i++) {
      if (e.bounds[i] === bounds[i]) continue;
      const range = { from: e.bounds[i], to: bounds[i] };
      for (const r of ctx.db.prepare(LEAVING_SALES_SQL).all({ ...range, maxSale: e.lastSaleId }) as { p: number; c: number }[]) bump(r.p, i, -r.c);
      for (const r of ctx.db.prepare(LEAVING_REFUNDS_SQL).all({ ...range, maxRefund: e.lastRefundId }) as { p: number; share: number }[]) bump(r.p, i, r.share);
    }
    e.bounds = bounds;
  }
  // 2. Add new sales and new refunds against the current windows.
  const params = { d7: bounds[0], d30: bounds[1], d90: bounds[2] };
  for (const r of ctx.db.prepare(SALES_SQL).all({ ...params, after: e.lastSaleId }) as { p: number; c7: number; c30: number; c90: number }[]) {
    bump(r.p, 0, r.c7);
    bump(r.p, 1, r.c30);
    bump(r.p, 2, r.c90);
  }
  for (const r of ctx.db.prepare(REFUNDS_SQL).all({ ...params, after: e.lastRefundId }) as { p: number; at: string; share: number }[]) {
    bounds.forEach((b, i) => {
      if (r.at >= b) bump(r.p, i, -r.share);
    });
  }
  e.lastSaleId = ids.s;
  e.lastRefundId = ids.r;

  const map = new Map<number, number>();
  for (const [productId, c] of e.counts) {
    if (c[2] < DEMAND_MIN_SALES - 1e-9) continue;
    map.set(productId, WINDOWS.reduce((sum, w, i) => sum + (w.weight * Math.max(0, c[i]!)) / w.days, 0));
  }
  e.map = map;
  cache.set(ctx.db, e);
  return map;
}
