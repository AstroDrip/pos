import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { postEntry } from './ledger';
import { requirePermission } from './users';

export interface ShiftSummary {
  shiftId: number;
  status: 'open' | 'closed';
  openingFloat: number;
  saleCount: number;
  cashSales: number; // cash tendered minus change given
  cardSales: number;
  cashIn: number;
  cashOut: number;
  refundCount: number;
  cashRefunds: number; // refunds are always paid in cash (owner decision D1)
  tillExpenses: number; // expenses paid out of this till (net of reversals)
  tillSupplierPayments: number; // suppliers paid out of this till (net of reversals)
  cashCollections: number; // customer payments received in cash (net of reversals)
  cardCollections: number;
  expectedCash: number;
  countedCash: number | null;
}

export function openShiftId(ctx: Ctx): number | null {
  const row = ctx.db.prepare("SELECT id FROM register_shifts WHERE status = 'open'").get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function openShift(ctx: Ctx, userId: number, openingFloat: number): number {
  requirePermission(ctx, userId, 'shift.open');
  if (!Number.isSafeInteger(openingFloat) || openingFloat < 0) throw new DomainError('VALIDATION', 'Invalid opening float');
  return ctx.db.transaction(() => {
    if (openShiftId(ctx) !== null) throw new DomainError('SHIFT_ALREADY_OPEN', 'A shift is already open');
    const id = Number(
      ctx.db
        .prepare("INSERT INTO register_shifts (user_id, opened_at, opening_float, status) VALUES (?, ?, ?, 'open')")
        .run(userId, ctx.now(), openingFloat).lastInsertRowid,
    );
    appendAudit(ctx, { userId, action: 'shift.open', entity: 'shift', entityId: id, details: { openingFloat } });
    return id;
  })();
}

export function recordCashMovement(ctx: Ctx, userId: number, kind: 'in' | 'out', amount: number, reason: string): void {
  requirePermission(ctx, userId, 'cash.move');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('VALIDATION', 'Amount must be positive');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  ctx.db.transaction(() => {
    const shiftId = openShiftId(ctx);
    if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'No open shift');
    const id = Number(
      ctx.db
        .prepare('INSERT INTO cash_movements (shift_id, kind, amount, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(shiftId, kind, amount, reason.trim(), userId, ctx.now()).lastInsertRowid,
    );
    // Suspense account 2900 until the accountant maps reasons to real accounts (migration 003).
    postEntry(ctx, {
      date: storeDay(ctx.now()),
      sourceType: 'cash_movement',
      sourceId: id,
      memo: `Cash ${kind}: ${reason.trim()}`,
      lines: kind === 'in' ? [{ account: '1010', debit: amount }, { account: '2900', credit: amount }] : [{ account: '2900', debit: amount }, { account: '1010', credit: amount }],
    });
    appendAudit(ctx, { userId, action: `cash.${kind}`, entity: 'cash_movement', entityId: id, details: { amount, reason } });
  })();
}

/** One step: counts and closes this cashier's shift and opens the next cashier's, with the counted cash as its float. */
export function handOverShift(ctx: Ctx, outgoingId: number, incomingId: number, countedCash: number): { closed: ShiftSummary; newShiftId: number } {
  if (outgoingId === incomingId) throw new DomainError('VALIDATION', 'Hand over to a different cashier');
  return ctx.db.transaction(() => {
    const closed = closeShift(ctx, outgoingId, countedCash);
    const newShiftId = openShift(ctx, incomingId, countedCash);
    const nameOf = (id: number) => (ctx.db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(id) as { n: string }).n;
    appendAudit(ctx, {
      userId: outgoingId,
      action: 'shift.handover',
      entity: 'shift',
      entityId: closed.shiftId,
      details: { from: nameOf(outgoingId), to: nameOf(incomingId), expected: closed.expectedCash, counted: countedCash, difference: countedCash - closed.expectedCash, newShiftId },
      related: { type: 'shift', id: newShiftId },
    });
    return { closed, newShiftId };
  })();
}

export function shiftSummary(ctx: Ctx, shiftId: number): ShiftSummary {
  const s = ctx.db.prepare('SELECT id, status, opening_float, counted_cash FROM register_shifts WHERE id = ?').get(shiftId) as
    | { id: number; status: 'open' | 'closed'; opening_float: number; counted_cash: number | null }
    | undefined;
  if (!s) throw new DomainError('NOT_FOUND', 'Shift not found');
  const q = (sql: string) => (ctx.db.prepare(sql).get(shiftId) as { v: number }).v;
  const saleCount = q('SELECT count(*) AS v FROM sales WHERE shift_id = ?');
  const cashTendered = q("SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND p.tender = 'cash'");
  const change = q('SELECT COALESCE(SUM(change_given),0) AS v FROM sales WHERE shift_id = ?');
  const cardSales = q("SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND p.tender = 'card'");
  const cashIn = q("SELECT COALESCE(SUM(amount),0) AS v FROM cash_movements WHERE shift_id = ? AND kind = 'in'");
  const cashOut = q("SELECT COALESCE(SUM(amount),0) AS v FROM cash_movements WHERE shift_id = ? AND kind = 'out'");
  const refundCount = q('SELECT count(*) AS v FROM refunds WHERE shift_id = ?');
  // Only the cash part of refunds leaves the drawer; a refund that reduced a customer's debt pays no cash.
  const cashRefunds = q('SELECT COALESCE(SUM(total_incl),0) - COALESCE((SELECT SUM(o.amount) FROM refund_account_offsets o JOIN refunds r2 ON r2.id = o.refund_id WHERE r2.shift_id = refunds.shift_id),0) AS v FROM refunds WHERE shift_id = ?');
  const tillExpenses = q("SELECT COALESCE(SUM(amount),0) AS v FROM expense_payments WHERE shift_id = ? AND method = 'till'");
  const tillSupplierPayments = q("SELECT COALESCE(SUM(amount),0) AS v FROM supplier_payments WHERE shift_id = ? AND method = 'till'");
  const cashCollections = q("SELECT COALESCE(SUM(amount),0) AS v FROM customer_receipts WHERE shift_id = ? AND method = 'cash'");
  const cardCollections = q("SELECT COALESCE(SUM(amount),0) AS v FROM customer_receipts WHERE shift_id = ? AND method = 'card'");
  const cashSales = cashTendered - change;
  return {
    shiftId,
    status: s.status,
    openingFloat: s.opening_float,
    saleCount,
    cashSales,
    cardSales,
    cashIn,
    cashOut,
    refundCount,
    cashRefunds,
    tillExpenses,
    tillSupplierPayments,
    cashCollections,
    cardCollections,
    expectedCash: s.opening_float + cashSales + cashCollections + cashIn - cashOut - cashRefunds - tillExpenses - tillSupplierPayments,
    countedCash: s.counted_cash,
  };
}

export interface PastShift {
  shiftId: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  saleCount: number;
  salesTotal: number;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
}

/** The latest shifts, newest first. Shows other people's cash differences, so it needs reports.view. */
export function listShifts(ctx: Ctx, userId: number, limit: number): PastShift[] {
  requirePermission(ctx, userId, 'reports.view');
  const rows = ctx.db
    .prepare(
      `SELECT r.id AS shiftId, r.status, r.opened_at AS openedAt, r.closed_at AS closedAt, u.display_name AS openedBy, r.expected_cash AS expectedCash, r.counted_cash AS countedCash,
              (SELECT count(*) FROM sales s WHERE s.shift_id = r.id) AS saleCount,
              (SELECT COALESCE(SUM(s.total_incl), 0) FROM sales s WHERE s.shift_id = r.id) AS salesTotal
       FROM register_shifts r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit) as Omit<PastShift, 'difference'>[];
  return rows.map((r) => ({ ...r, difference: r.countedCash === null || r.expectedCash === null ? null : r.countedCash - r.expectedCash }));
}

/** Closes the open shift. Any cash difference is posted to Cash over/short. */
export function closeShift(ctx: Ctx, userId: number, countedCash: number): ShiftSummary {
  requirePermission(ctx, userId, 'shift.close');
  if (!Number.isSafeInteger(countedCash) || countedCash < 0) throw new DomainError('VALIDATION', 'Invalid counted cash');
  return ctx.db.transaction(() => {
    const shiftId = openShiftId(ctx);
    if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'No open shift');
    const summary = shiftSummary(ctx, shiftId);
    const diff = countedCash - summary.expectedCash;
    ctx.db
      .prepare("UPDATE register_shifts SET status = 'closed', closed_at = ?, closed_by = ?, expected_cash = ?, counted_cash = ? WHERE id = ?")
      .run(ctx.now(), userId, summary.expectedCash, countedCash, shiftId);
    if (diff !== 0) {
      postEntry(ctx, {
        date: storeDay(ctx.now()),
        sourceType: 'shift_close',
        sourceId: shiftId,
        memo: `Cash ${diff > 0 ? 'over' : 'short'} at shift close`,
        lines:
          diff > 0
            ? [{ account: '1010', debit: diff }, { account: '6000', credit: diff }]
            : [{ account: '6000', debit: -diff }, { account: '1010', credit: -diff }],
      });
    }
    appendAudit(ctx, { userId, action: 'shift.close', entity: 'shift', entityId: shiftId, details: { expected: summary.expectedCash, counted: countedCash, diff } });
    if (diff !== 0) appendAudit(ctx, { userId, action: 'shift.cash_difference', entity: 'shift', entityId: shiftId, details: { expected: summary.expectedCash, counted: countedCash, difference: diff } });
    return shiftSummary(ctx, shiftId);
  })();
}
