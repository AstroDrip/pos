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
  const cashRefunds = q('SELECT COALESCE(SUM(total_incl),0) AS v FROM refunds WHERE shift_id = ?');
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
    expectedCash: s.opening_float + cashSales + cashIn - cashOut - cashRefunds,
    countedCash: s.counted_cash,
  };
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
    return shiftSummary(ctx, shiftId);
  })();
}
