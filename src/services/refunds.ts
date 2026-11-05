import { roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { applyMovement, cogsTrueUpLines } from './inventory';
import { postEntry } from './ledger';
import type { ReceiptData } from './sales';
import { openShiftId } from './shifts';
import { hasPermission, requirePermission } from './users';

// Owner refund policy (decision D1, 2026-11-05):
//  - only against the original receipt (invoice number), so every refund is linked to a sale
//  - within refund_max_days store days of the sale (7)
//  - paid back in cash from the open shift's drawer, even when the sale was paid by card
//  - every refund needs a supervisor (sale.refund): the logged-in supervisor, or a supervisor's PIN

export interface RefundableLine {
  saleLineNo: number;
  productId: number;
  nameAr: string;
  nameEn: string;
  sellMode: 'unit' | 'weight';
  soldQty: number;
  refundedQty: number;
  remainingQty: number;
  unitPriceIncl: number;
  lineIncl: number; // what the customer paid for the whole line (after discount)
}

export interface RefundableSale {
  saleId: number;
  invoiceNo: string;
  createdAt: string;
  cashier: string;
  totalIncl: number;
  paidByCard: number;
  daysSinceSale: number;
  maxDays: number;
  withinWindow: boolean;
  lines: RefundableLine[];
  refunds: { refundNo: string; createdAt: string; totalIncl: number }[];
}

export function refundMaxDays(ctx: Ctx): number {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'refund_max_days'").get() as { value: string } | undefined;
  const n = Number(row?.value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 7;
}

/** Whole store days between two timestamps (same day = 0). */
function storeDaysBetween(fromIso: string, toIso: string): number {
  return Math.trunc((Date.parse(`${storeDay(toIso)}T00:00:00Z`) - Date.parse(`${storeDay(fromIso)}T00:00:00Z`)) / 86_400_000);
}

/** Finds a sale by invoice number and shows what can still be refunded. */
export function findSaleForRefund(ctx: Ctx, userId: number, invoiceNo: string): RefundableSale {
  requirePermission(ctx, userId, 'sale.create');
  const no = invoiceNo.trim().toUpperCase();
  const s = ctx.db
    .prepare('SELECT s.id, s.invoice_no, s.created_at, s.total_incl, u.display_name AS cashier FROM sales s JOIN users u ON u.id = s.user_id WHERE s.invoice_no = ?')
    .get(no) as { id: number; invoice_no: string; created_at: string; total_incl: number; cashier: string } | undefined;
  if (!s) throw new DomainError('NOT_FOUND', `No sale with invoice number ${no}. Check the receipt.`);
  const lines = ctx.db
    .prepare(
      `SELECT l.line_no AS saleLineNo, l.product_id AS productId, l.name_ar AS nameAr, l.name_en AS nameEn, p.sell_mode AS sellMode,
              l.qty AS soldQty, l.unit_price_incl AS unitPriceIncl, l.line_incl AS lineIncl,
              COALESCE((SELECT SUM(rl.qty) FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
                        WHERE r.original_sale_id = l.sale_id AND rl.sale_line_no = l.line_no), 0) AS refundedQty
       FROM sale_lines l JOIN products p ON p.id = l.product_id WHERE l.sale_id = ? ORDER BY l.line_no`,
    )
    .all(s.id) as Omit<RefundableLine, 'remainingQty'>[];
  const maxDays = refundMaxDays(ctx);
  const days = storeDaysBetween(s.created_at, ctx.now());
  return {
    saleId: s.id,
    invoiceNo: s.invoice_no,
    createdAt: s.created_at,
    cashier: s.cashier,
    totalIncl: s.total_incl,
    paidByCard: (ctx.db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE sale_id = ? AND tender = 'card'").get(s.id) as { v: number }).v,
    daysSinceSale: days,
    maxDays,
    withinWindow: days >= 0 && days <= maxDays,
    lines: lines.map((l) => ({ ...l, remainingQty: l.soldQty - l.refundedQty })),
    refunds: ctx.db
      .prepare('SELECT refund_no AS refundNo, created_at AS createdAt, total_incl AS totalIncl FROM refunds WHERE original_sale_id = ? ORDER BY id')
      .all(s.id) as RefundableSale['refunds'],
  };
}

export interface RefundInput {
  /** One key per refund screen. Re-sending it returns the first refund instead of paying out twice. */
  requestKey: string;
  invoiceNo: string;
  reason: string;
  lines: { saleLineNo: number; qty: number; restock: boolean }[];
  /** Supervisor who approved, when the logged-in user lacks sale.refund. */
  approverId?: number;
}

export interface RefundResult {
  refundId: number;
  refundNo: string;
  totalIncl: number;
  cashOut: number;
  replayed: boolean;
}

/**
 * Refunds part or all of a sale in ONE transaction: credit note number, refund and lines, stock back on the
 * shelf (when resaleable), journal entry, audit row. The original sale is never changed.
 */
export function createRefund(ctx: Ctx, userId: number, input: RefundInput): RefundResult {
  requirePermission(ctx, userId, 'sale.create');
  if (!/^[\w-]{8,64}$/.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  const reason = input.reason.trim();
  if (!reason) throw new DomainError('VALIDATION', 'A refund reason is required');
  if (input.lines.length === 0) throw new DomainError('VALIDATION', 'Choose at least one item to refund');

  return ctx.db.transaction((): RefundResult => {
    const done = ctx.db.prepare('SELECT id, refund_no, total_incl FROM refunds WHERE request_key = ?').get(input.requestKey) as
      | { id: number; refund_no: string; total_incl: number }
      | undefined;
    if (done) return { refundId: done.id, refundNo: done.refund_no, totalIncl: done.total_incl, cashOut: done.total_incl, replayed: true };

    let approver: number;
    if (hasPermission(ctx, userId, 'sale.refund')) approver = userId;
    else if (input.approverId !== undefined && hasPermission(ctx, input.approverId, 'sale.refund')) approver = input.approverId;
    else throw new DomainError('PERMISSION_DENIED', 'A refund needs supervisor approval');

    const shiftId = openShiftId(ctx);
    if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Open a shift before refunding: the cash comes from the drawer');

    const sale = findSaleForRefund(ctx, userId, input.invoiceNo);
    if (sale.daysSinceSale < 0) throw new DomainError('CLOCK_WRONG', 'The computer clock is earlier than the sale date. Fix the Windows date and time.');
    if (!sale.withinWindow) {
      throw new DomainError('VALIDATION', `This sale is ${sale.daysSinceSale} days old. Refunds are allowed within ${sale.maxDays} days.`);
    }

    const seen = new Set<number>();
    const priced = input.lines.map((req) => {
      if (seen.has(req.saleLineNo)) throw new DomainError('VALIDATION', 'The same item is listed twice');
      seen.add(req.saleLineNo);
      const line = sale.lines.find((l) => l.saleLineNo === req.saleLineNo);
      if (!line) throw new DomainError('NOT_FOUND', 'That item is not on this receipt');
      if (!Number.isSafeInteger(req.qty) || req.qty <= 0) throw new DomainError('VALIDATION', 'Refund quantity must be positive');
      if (line.sellMode === 'unit' && req.qty % 1000 !== 0) throw new DomainError('VALIDATION', `${line.nameEn} is refunded by whole units`);
      if (req.qty > line.remainingQty) {
        throw new DomainError('VALIDATION', `${line.nameEn}: only ${line.remainingQty / 1000} left to refund on this receipt`);
      }
      const sl = ctx.db
        .prepare('SELECT line_incl, line_vat, vat_rate_bp, unit_cost FROM sale_lines WHERE sale_id = ? AND line_no = ?')
        .get(sale.saleId, line.saleLineNo) as { line_incl: number; line_vat: number; vat_rate_bp: number; unit_cost: number };
      const prior = ctx.db
        .prepare(
          `SELECT COALESCE(SUM(rl.line_incl),0) AS incl, COALESCE(SUM(rl.line_vat),0) AS vat FROM refund_lines rl
           JOIN refunds r ON r.id = rl.refund_id WHERE r.original_sale_id = ? AND rl.sale_line_no = ?`,
        )
        .get(sale.saleId, line.saleLineNo) as { incl: number; vat: number };
      // The customer gets back what they paid for these units (discount included). Refunding the last units
      // returns the exact remainder, so all refunds of a line never add up to more than was paid.
      let incl: number;
      let vat: number;
      if (req.qty === line.remainingQty) {
        incl = sl.line_incl - prior.incl;
        vat = sl.line_vat - prior.vat;
      } else {
        incl = Math.min(roundDiv(sl.line_incl * req.qty, line.soldQty), sl.line_incl - prior.incl);
        vat = Math.min(roundDiv(sl.line_vat * req.qty, line.soldQty), sl.line_vat - prior.vat, incl);
      }
      return { req, line, incl, vat, vatRate: sl.vat_rate_bp, unitCost: sl.unit_cost };
    });

    const totalIncl = priced.reduce((s, p) => s + p.incl, 0);
    const totalVat = priced.reduce((s, p) => s + p.vat, 0);
    if (totalIncl <= 0) throw new DomainError('VALIDATION', 'Nothing to refund: these items were free');

    const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'REFUND' RETURNING next_value - 1 AS v").get() as { v: number }).v;
    const refundNo = `CN-${String(n).padStart(8, '0')}`;
    const createdAt = ctx.now();
    const refundId = Number(
      ctx.db
        .prepare(
          `INSERT INTO refunds (refund_no, uuid, request_key, original_sale_id, shift_id, user_id, approved_by, reason, tender,
             total_incl, total_vat, total_excl, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?)`,
        )
        .run(refundNo, ctx.uuid(), input.requestKey, sale.saleId, shiftId, userId, approver, reason, totalIncl, totalVat, totalIncl - totalVat, createdAt)
        .lastInsertRowid,
    );

    const insertLine = ctx.db.prepare(
      `INSERT INTO refund_lines (refund_id, line_no, sale_line_no, product_id, name_ar, name_en, qty, unit_price_incl, vat_rate_bp,
         line_incl, line_vat, line_excl, unit_cost, restock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let restockedCost = 0;
    let trueUp = 0;
    priced.forEach((p, i) => {
      insertLine.run(refundId, i + 1, p.line.saleLineNo, p.line.productId, p.line.nameAr, p.line.nameEn, p.req.qty, p.line.unitPriceIncl,
        p.vatRate, p.incl, p.vat, p.incl - p.vat, p.unitCost, p.req.restock ? 1 : 0);
      // Resaleable goods go back on the shelf at the cost they left at. Damaged goods are not restocked:
      // their cost stays an expense (the accountant may want a separate wastage account for them).
      if (p.req.restock) {
        const mv = applyMovement(ctx, { productId: p.line.productId, qty: p.req.qty, unitCost: p.unitCost, reason: 'refund', sourceType: 'refund', sourceId: refundId, sourceLine: i + 1, userId });
        restockedCost += mv.value;
        trueUp += mv.cogsTrueUp;
      }
    });

    postEntry(ctx, {
      date: storeDay(createdAt),
      sourceType: 'refund',
      sourceId: refundId,
      memo: `Refund ${refundNo} for ${sale.invoiceNo}`,
      lines: [
        { account: '4000', debit: totalIncl - totalVat },
        { account: '2200', debit: totalVat },
        { account: '1010', credit: totalIncl },
        { account: '1200', debit: restockedCost },
        { account: '5000', credit: restockedCost },
        ...cogsTrueUpLines(trueUp),
      ],
    });

    appendAudit(ctx, {
      userId,
      action: 'sale.refund',
      entity: 'refund',
      entityId: refundId,
      details: { refundNo, invoiceNo: sale.invoiceNo, total: totalIncl, approver, reason, lines: priced.length },
    });

    return { refundId, refundNo, totalIncl, cashOut: totalIncl, replayed: false };
  })();
}

/** Credit-note receipt content, from the stored refund only. */
export function refundReceiptData(ctx: Ctx, refundId: number): ReceiptData {
  const r = ctx.db
    .prepare(
      `SELECT r.refund_no, r.uuid, r.created_at, r.reason, r.total_incl, r.total_vat, r.total_excl, s.invoice_no,
              u.display_name AS cashier, a.display_name AS approver
       FROM refunds r JOIN sales s ON s.id = r.original_sale_id JOIN users u ON u.id = r.user_id JOIN users a ON a.id = r.approved_by
       WHERE r.id = ?`,
    )
    .get(refundId) as
    | { refund_no: string; uuid: string; created_at: string; reason: string; total_incl: number; total_vat: number; total_excl: number; invoice_no: string; cashier: string; approver: string }
    | undefined;
  if (!r) throw new DomainError('NOT_FOUND', 'Refund not found');
  return {
    kind: 'refund',
    invoiceNo: r.refund_no,
    uuid: r.uuid,
    createdAt: r.created_at,
    cashier: r.cashier,
    approver: r.approver,
    originalInvoiceNo: r.invoice_no,
    reason: r.reason,
    lines: ctx.db
      .prepare('SELECT name_ar AS nameAr, name_en AS nameEn, qty, unit_price_incl AS unitPriceIncl, 0 AS discount, line_incl AS lineIncl, vat_rate_bp AS vatRateBp FROM refund_lines WHERE refund_id = ? ORDER BY line_no')
      .all(refundId) as ReceiptData['lines'],
    totalExcl: r.total_excl,
    totalVat: r.total_vat,
    totalIncl: r.total_incl,
    totalDiscount: 0,
    payments: [{ tender: 'cash', amount: r.total_incl }],
    changeGiven: 0,
  };
}
