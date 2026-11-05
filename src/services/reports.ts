import { nextDay, sqlStoreDay, storeDayStartUtc } from '../core/store-time';
import { DomainError, type Ctx } from './context';
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
  /** Refunds made in the period (cash, any original sale date). Net = sales minus refunds. */
  refundCount: number;
  refundTotal: number;
  refundVat: number;
  netIncl: number;
  netVat: number;
  byDay: { day: string; saleCount: number; totalIncl: number; totalVat: number }[];
  topProducts: { productId: number; nameEn: string; qty: number; totalIncl: number }[];
}

/** Sales for store days fromDay..toDay inclusive ("YYYY-MM-DD", Saudi time). */
export function salesSummary(ctx: Ctx, userId: number, fromDay: string, toDay: string): SalesSummary {
  requirePermission(ctx, userId, 'reports.view');
  if (toDay < fromDay) throw new DomainError('VALIDATION', '"To" date is before "From" date');
  const from = storeDayStartUtc(fromDay);
  const to = storeDayStartUtc(nextDay(toDay));
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
  const r = ctx.db
    .prepare('SELECT count(*) AS n, COALESCE(SUM(total_incl),0) AS incl, COALESCE(SUM(total_vat),0) AS vat FROM refunds WHERE created_at >= ? AND created_at < ?')
    .get(from, to) as { n: number; incl: number; vat: number };
  return {
    from: fromDay,
    to: toDay,
    ...totals,
    cash: tender('cash') - change,
    card: tender('card'),
    refundCount: r.n,
    refundTotal: r.incl,
    refundVat: r.vat,
    netIncl: totals.totalIncl - r.incl,
    netVat: totals.totalVat - r.vat,
    byDay: ctx.db
      .prepare(
        `SELECT ${sqlStoreDay('created_at')} AS day, count(*) AS saleCount, SUM(total_incl) AS totalIncl, SUM(total_vat) AS totalVat
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

export interface VoidRow {
  at: string;
  user: string;
  kind: string;
  invoiceNo: string | null; // null = the bill was never paid (cleared, or still open/held)
  items: number;
  total: number;
}

/** Items removed from bills before payment, for store days fromDay..toDay (Saudi time). */
export function voidsReport(ctx: Ctx, userId: number, fromDay: string, toDay: string): VoidRow[] {
  requirePermission(ctx, userId, 'reports.view');
  return (
    ctx.db
      .prepare(
        `SELECT a.at, COALESCE(u.display_name, '?') AS user, a.action AS kind, a.details_json, s.invoice_no
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN sales s ON s.idempotency_key = a.entity_id
         WHERE a.action IN ('sale.line_removed', 'sale.bill_cleared') AND a.at >= ? AND a.at < ? ORDER BY a.id`,
      )
      .all(storeDayStartUtc(fromDay), storeDayStartUtc(nextDay(toDay))) as { at: string; user: string; kind: string; details_json: string; invoice_no: string | null }[]
  ).map((r) => {
    const d = JSON.parse(r.details_json) as { lines: unknown[]; total: number };
    return { at: r.at, user: r.user, kind: r.kind.replace('sale.', ''), invoiceNo: r.invoice_no, items: d.lines.length, total: d.total };
  });
}

export interface CashierActivity {
  userId: number;
  user: string;
  sales: number;
  salesTotal: number;
  cashNet: number;
  card: number;
  discountCount: number;
  discountTotal: number;
  removals: number;
  removedValue: number;
  reprints: number;
  refundCount: number; // refunds this user processed
  refundTotal: number;
  refundsApproved: number; // refunds this user approved (supervisors)
  cashOutCount: number;
  cashOutTotal: number;
  shiftsClosed: number;
  overShortTotal: number; // counted - expected over closed shifts (negative = short)
}

/**
 * Per-cashier activity for store days fromDay..toDay (audit Part 14). These are facts for the owner to review,
 * not accusations: a high number can have an innocent reason.
 */
export function cashierActivity(ctx: Ctx, userId: number, fromDay: string, toDay: string): CashierActivity[] {
  requirePermission(ctx, userId, 'reports.view');
  const from = storeDayStartUtc(fromDay);
  const to = storeDayStartUtc(nextDay(toDay));
  const users = ctx.db.prepare('SELECT id, display_name FROM users ORDER BY display_name').all() as { id: number; display_name: string }[];
  const one = (sql: string, ...args: unknown[]) => ctx.db.prepare(sql).get(...args) as Record<string, number>;
  return users
    .map((u) => {
      const s = one(
        `SELECT count(*) AS n, COALESCE(SUM(total_incl),0) AS total, COALESCE(SUM(total_discount),0) AS disc,
                COALESCE(SUM(CASE WHEN total_discount > 0 THEN 1 ELSE 0 END),0) AS discN, COALESCE(SUM(change_given),0) AS change
         FROM sales WHERE user_id = ? AND created_at >= ? AND created_at < ?`, u.id, from, to);
      const pay = (t: string) => one(`SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.user_id = ? AND p.tender = ? AND s.created_at >= ? AND s.created_at < ?`, u.id, t, from, to).v!;
      const audit = (actions: string) => ctx.db.prepare(`SELECT details_json FROM audit_log WHERE user_id = ? AND action IN (${actions}) AND at >= ? AND at < ?`).all(u.id, from, to) as { details_json: string }[];
      const removed = audit("'sale.line_removed','sale.bill_cleared'");
      const ref = one('SELECT count(*) AS n, COALESCE(SUM(total_incl),0) AS v FROM refunds WHERE user_id = ? AND created_at >= ? AND created_at < ?', u.id, from, to);
      const approved = one('SELECT count(*) AS n FROM refunds WHERE approved_by = ? AND created_at >= ? AND created_at < ?', u.id, from, to);
      const out = one(`SELECT count(*) AS n, COALESCE(SUM(amount),0) AS v FROM cash_movements WHERE user_id = ? AND kind = 'out' AND at >= ? AND at < ?`, u.id, from, to);
      const shifts = one(`SELECT count(*) AS n, COALESCE(SUM(counted_cash - expected_cash),0) AS v FROM register_shifts WHERE closed_by = ? AND closed_at >= ? AND closed_at < ?`, u.id, from, to);
      return {
        userId: u.id,
        user: u.display_name,
        sales: s.n!,
        salesTotal: s.total!,
        cashNet: pay('cash') - s.change!,
        card: pay('card'),
        discountCount: s.discN!,
        discountTotal: s.disc!,
        removals: removed.length,
        removedValue: removed.reduce((sum, r) => sum + ((JSON.parse(r.details_json) as { total?: number }).total ?? 0), 0),
        reprints: audit("'sale.reprint'").length,
        refundCount: ref.n!,
        refundTotal: ref.v!,
        refundsApproved: approved.n!,
        cashOutCount: out.n!,
        cashOutTotal: out.v!,
        shiftsClosed: shifts.n!,
        overShortTotal: shifts.v!,
      };
    })
    .filter((a) => a.sales + a.removals + a.reprints + a.refundCount + a.refundsApproved + a.cashOutCount + a.shiftsClosed > 0);
}

export interface RefundRow {
  refundId: number;
  refundNo: string;
  at: string;
  invoiceNo: string;
  saleAt: string;
  cashier: string;
  approver: string;
  reason: string;
  items: number;
  restockedItems: number;
  total: number;
}

/** Refunds (credit notes) made on store days fromDay..toDay. */
export function refundsReport(ctx: Ctx, userId: number, fromDay: string, toDay: string): RefundRow[] {
  requirePermission(ctx, userId, 'reports.view');
  if (toDay < fromDay) throw new DomainError('VALIDATION', '"To" date is before "From" date');
  return ctx.db
    .prepare(
      `SELECT r.id AS refundId, r.refund_no AS refundNo, r.created_at AS at, s.invoice_no AS invoiceNo, s.created_at AS saleAt,
              u.display_name AS cashier, a.display_name AS approver, r.reason, r.total_incl AS total,
              (SELECT count(*) FROM refund_lines l WHERE l.refund_id = r.id) AS items,
              (SELECT count(*) FROM refund_lines l WHERE l.refund_id = r.id AND l.restock = 1) AS restockedItems
       FROM refunds r JOIN sales s ON s.id = r.original_sale_id JOIN users u ON u.id = r.user_id JOIN users a ON a.id = r.approved_by
       WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.id`,
    )
    .all(storeDayStartUtc(fromDay), storeDayStartUtc(nextDay(toDay))) as RefundRow[];
}

export interface AdjustmentRow {
  adjNo: string;
  at: string;
  kind: 'waste' | 'count';
  reason: string;
  user: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  systemQty: number;
  countedQty: number | null;
  qty: number;
  value: number;
}

/** Wastage and stock-count differences, one row per product line, for store days fromDay..toDay. */
export function adjustmentsReport(ctx: Ctx, userId: number, fromDay: string, toDay: string): AdjustmentRow[] {
  requirePermission(ctx, userId, 'reports.view');
  if (toDay < fromDay) throw new DomainError('VALIDATION', '"To" date is before "From" date');
  return ctx.db
    .prepare(
      `SELECT a.adj_no AS adjNo, a.created_at AS at, a.kind, a.reason, u.display_name AS user, p.sku, p.name_en AS nameEn, p.name_ar AS nameAr,
              l.system_qty AS systemQty, l.counted_qty AS countedQty, l.qty, l.value
       FROM stock_adjustments a JOIN stock_adjustment_lines l ON l.adjustment_id = a.id JOIN products p ON p.id = l.product_id
       JOIN users u ON u.id = a.user_id
       WHERE a.created_at >= ? AND a.created_at < ? ORDER BY a.id, l.line_no`,
    )
    .all(storeDayStartUtc(fromDay), storeDayStartUtc(nextDay(toDay))) as AdjustmentRow[];
}
