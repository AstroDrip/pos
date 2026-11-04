import type { Ctx } from './context';
import { requirePermission } from './users';

export interface StockRow {
  productId: number;
  sku: string;
  nameEn: string;
  nameAr: string;
  qty: number;
  reorderLevel: number;
  avgCost: number;
}

export function stockOnHand(ctx: Ctx, userId: number, onlyLow = false): StockRow[] {
  requirePermission(ctx, userId, 'reports.view');
  return ctx.db
    .prepare(
      `SELECT p.id AS productId, p.sku, p.name_en AS nameEn, p.name_ar AS nameAr, COALESCE(b.qty,0) AS qty,
              p.reorder_level AS reorderLevel, COALESCE(b.avg_cost,0) AS avgCost
       FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id
       WHERE p.active = 1 ${onlyLow ? 'AND COALESCE(b.qty,0) <= p.reorder_level' : ''}
       ORDER BY ${onlyLow ? 'qty - p.reorder_level, ' : ''}p.name_en`,
    )
    .all() as StockRow[];
}

export interface SalesSummary {
  from: string;
  to: string;
  saleCount: number;
  totalIncl: number;
  totalVat: number;
  totalExcl: number;
  totalDiscount: number;
  cash: number;
  card: number;
  byDay: { day: string; saleCount: number; totalIncl: number; totalVat: number }[];
  topProducts: { productId: number; nameEn: string; qty: number; totalIncl: number }[];
}

/** Sales between two UTC ISO dates (from inclusive, to exclusive). */
export function salesSummary(ctx: Ctx, userId: number, from: string, to: string): SalesSummary {
  requirePermission(ctx, userId, 'reports.view');
  const t = ctx.db
    .prepare(
      `SELECT count(*) AS saleCount, COALESCE(SUM(total_incl),0) AS totalIncl, COALESCE(SUM(total_vat),0) AS totalVat,
              COALESCE(SUM(total_excl),0) AS totalExcl, COALESCE(SUM(total_discount),0) AS totalDiscount,
              COALESCE(SUM(change_given),0) AS change
       FROM sales WHERE created_at >= ? AND created_at < ?`,
    )
    .get(from, to) as Omit<SalesSummary, 'from' | 'to' | 'cash' | 'card' | 'byDay' | 'topProducts'> & { change: number };
  const tender = (k: string) =>
    (ctx.db.prepare('SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.tender = ? AND s.created_at >= ? AND s.created_at < ?').get(k, from, to) as { v: number }).v;
  const { change, ...totals } = t;
  return {
    from,
    to,
    ...totals,
    cash: tender('cash') - change,
    card: tender('card'),
    byDay: ctx.db
      .prepare(
        `SELECT substr(created_at,1,10) AS day, count(*) AS saleCount, SUM(total_incl) AS totalIncl, SUM(total_vat) AS totalVat
         FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY day ORDER BY day`,
      )
      .all(from, to) as SalesSummary['byDay'],
    topProducts: ctx.db
      .prepare(
        `SELECT l.product_id AS productId, MAX(l.name_en) AS nameEn, SUM(l.qty) AS qty, SUM(l.line_incl) AS totalIncl
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.created_at >= ? AND s.created_at < ?
         GROUP BY l.product_id ORDER BY totalIncl DESC LIMIT 20`,
      )
      .all(from, to) as SalesSummary['topProducts'],
  };
}
