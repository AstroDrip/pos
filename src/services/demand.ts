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

interface CacheEntry { key: string; map: Map<number, number> }
let cache = new WeakMap<Database.Database, CacheEntry>();

/** Tests only: forget every cached score. */
export function resetDemandCache(): void {
  cache = new WeakMap();
}

export function demandScores(ctx: Ctx, now: Date = new Date(ctx.now())): Map<number, number> {
  const ids = ctx.db
    .prepare('SELECT (SELECT COALESCE(MAX(id), 0) FROM sales) AS s, (SELECT COALESCE(MAX(id), 0) FROM refunds) AS r')
    .get() as { s: number; r: number };
  // The windows move with time, so the key also changes every hour.
  const key = `${ids.s}:${ids.r}:${Math.floor(now.getTime() / 3_600_000)}`;
  const hit = cache.get(ctx.db);
  if (hit?.key === key) return hit.map;

  const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const rows = ctx.db
    .prepare(
      `SELECT l.product_id AS productId, s.created_at AS at,
              1.0 - MIN(1.0, COALESCE((SELECT SUM(rl.qty) FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
                                       WHERE r.original_sale_id = s.id AND rl.product_id = l.product_id), 0) * 1.0 / SUM(l.qty)) AS net
         FROM sales s JOIN sale_lines l ON l.sale_id = s.id
        WHERE s.created_at >= ?
        GROUP BY s.id, l.product_id`,
    )
    .all(since) as { productId: number; at: string; net: number }[];

  const counts = new Map<number, number[]>();
  for (const r of rows) {
    if (r.net <= 0) continue;
    const age = now.getTime() - Date.parse(r.at);
    const c = counts.get(r.productId) ?? WINDOWS.map(() => 0);
    WINDOWS.forEach((w, i) => {
      if (age <= w.days * DAY_MS) c[i]! += r.net;
    });
    counts.set(r.productId, c);
  }
  const map = new Map<number, number>();
  for (const [productId, c] of counts) {
    if (c[2]! < DEMAND_MIN_SALES) continue;
    map.set(productId, WINDOWS.reduce((sum, w, i) => sum + (w.weight * c[i]!) / w.days, 0));
  }
  cache.set(ctx.db, { key, map });
  return map;
}
