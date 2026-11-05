import { storeDay } from '../core/store-time';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { postEntry, type PostingLine } from './ledger';
import { openShiftId } from './shifts';
import { requirePermission } from './users';

// Store expenses (ADR-4, PROVISIONAL accounting until the accountant approves).
//  draft ──post──▶ posted ──payments──▶ paid          draft ──cancel──▶ cancelled
//                    └──reverse (nothing paid)──▶ reversed
// Recognition (expense date): Dr expense or prepaid or equipment (+ Dr 2210 recoverable VAT) / Cr 2010.
// Payment (payment date):     Dr 2010 / Cr 1030 Bank or Cr 1010 Cash (till, inside an open shift).
// Every posting goes through the existing journal engine; corrections are reversal entries.

export type VatClass = 'standard' | 'zero' | 'exempt' | 'out_of_scope';
export type PayMethod = 'bank' | 'till';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ExpenseCategory {
  id: number;
  nameEn: string;
  nameAr: string;
  accountCode: string;
  kind: 'operating' | 'capital';
  active: boolean;
}

export interface ExpenseInput {
  requestKey: string;
  categoryId: number;
  description: string;
  payee?: string;
  invoiceRef?: string;
  supplierVatNo?: string;
  notes?: string;
  attachmentRef?: string;
  expenseDate: string;
  dueDate?: string;
  periodStart?: string; // 'YYYY-MM' — set both for a prepaid expense covering several months
  periodEnd?: string;
  gross: number; // halalas incl. VAT, as on the supplier invoice
  vatClass: VatClass;
  vatAmount: number; // from the supplier invoice; never assumed
  vatRecoverable: boolean;
}

export interface ExpenseRow {
  id: number;
  expenseNo: string;
  categoryId: number;
  category: string;
  categoryKind: 'operating' | 'capital';
  description: string;
  payee: string | null;
  invoiceRef: string | null;
  supplierVatNo: string | null;
  notes: string | null;
  attachmentRef: string | null;
  expenseDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: number;
  vatClass: VatClass;
  vatAmount: number;
  vatRecoverable: boolean;
  amountConfirmed: boolean;
  status: 'draft' | 'posted' | 'cancelled' | 'reversed';
  recurringId: number | null;
  recurringPeriod: string | null;
  paid: number;
  outstanding: number;
  /** Display status: draft | unpaid | partial | paid | overdue | cancelled | reversed */
  payState: string;
  createdBy: string;
  postedBy: string | null;
  closedBy: string | null;
  closeReason: string | null;
}

const today = (ctx: Ctx) => storeDay(ctx.now());

// ── categories ──────────────────────────────────────────────

export function listCategories(ctx: Ctx, userId: number): ExpenseCategory[] {
  requirePermission(ctx, userId, 'expense.view');
  return (ctx.db.prepare('SELECT id, name_en, name_ar, account_code, kind, active FROM expense_categories ORDER BY kind, name_en').all() as {
    id: number; name_en: string; name_ar: string; account_code: string; kind: 'operating' | 'capital'; active: number;
  }[]).map((r) => ({ id: r.id, nameEn: r.name_en, nameAr: r.name_ar, accountCode: r.account_code, kind: r.kind, active: r.active === 1 }));
}

/** Accounts a category may post to: operating expense accounts (6xxx) or, for capital, asset 1500. */
export function categoryAccounts(ctx: Ctx, userId: number): { code: string; nameEn: string; type: string }[] {
  requirePermission(ctx, userId, 'expense.view');
  return ctx.db
    .prepare("SELECT code, name_en AS nameEn, type FROM accounts WHERE is_postable = 1 AND ((type = 'expense' AND code >= '6100') OR code = '1500') ORDER BY code")
    .all() as { code: string; nameEn: string; type: string }[];
}

export function saveCategory(ctx: Ctx, userId: number, c: { id?: number; nameEn: string; nameAr: string; accountCode: string; active: boolean }): number {
  requirePermission(ctx, userId, 'expense.approve');
  const acc = categoryAccounts(ctx, userId).find((a) => a.code === c.accountCode);
  if (!acc) throw new DomainError('VALIDATION', 'Choose an expense account (6100–6999) or Equipment (1500)');
  if (!c.nameEn.trim()) throw new DomainError('VALIDATION', 'Category needs a name');
  const kind = c.accountCode === '1500' ? 'capital' : 'operating';
  return ctx.db.transaction(() => {
    let id = c.id ?? 0;
    try {
      if (c.id) {
        // Changing a category's account only affects expenses posted from now on; posted journals never change.
        const r = ctx.db.prepare('UPDATE expense_categories SET name_en = ?, name_ar = ?, account_code = ?, kind = ?, active = ? WHERE id = ?')
          .run(c.nameEn.trim(), c.nameAr.trim() || c.nameEn.trim(), c.accountCode, kind, c.active ? 1 : 0, c.id);
        if (r.changes === 0) throw new DomainError('NOT_FOUND', 'Category not found');
      } else {
        id = Number(ctx.db.prepare('INSERT INTO expense_categories (name_en, name_ar, account_code, kind, active) VALUES (?, ?, ?, ?, ?)')
          .run(c.nameEn.trim(), c.nameAr.trim() || c.nameEn.trim(), c.accountCode, kind, c.active ? 1 : 0).lastInsertRowid);
      }
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError('CONFLICT', 'A category with this name already exists');
    }
    appendAudit(ctx, { userId, action: 'expense.category_saved', entity: 'expense_category', entityId: id, details: c });
    return id;
  })();
}

// ── validation ──────────────────────────────────────────────

function months(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number) as [number, number];
  const [ey, em] = end.split('-').map(Number) as [number, number];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 60) throw new DomainError('VALIDATION', 'Service period is longer than 5 years');
  }
  return out;
}

function validate(ctx: Ctx, e: Omit<ExpenseInput, 'requestKey'>): void {
  if (!e.description.trim()) throw new DomainError('VALIDATION', 'Description is required');
  if (!DAY.test(e.expenseDate)) throw new DomainError('VALIDATION', 'Expense date must be YYYY-MM-DD');
  if (e.dueDate && !DAY.test(e.dueDate)) throw new DomainError('VALIDATION', 'Due date must be YYYY-MM-DD');
  if (!Number.isSafeInteger(e.gross) || e.gross <= 0) throw new DomainError('VALIDATION', 'Amount must be more than zero');
  if (!Number.isSafeInteger(e.vatAmount) || e.vatAmount < 0 || e.vatAmount > e.gross) throw new DomainError('VALIDATION', 'VAT must be between 0 and the total');
  if (e.vatClass !== 'standard' && (e.vatAmount !== 0 || e.vatRecoverable)) {
    throw new DomainError('VALIDATION', 'Zero-rated, exempt and out-of-scope expenses have no VAT');
  }
  if (e.vatRecoverable) {
    if (e.vatAmount <= 0) throw new DomainError('VALIDATION', 'Recoverable VAT needs the VAT amount from the invoice');
    // Input VAT can only be claimed with a proper tax invoice (PROVISIONAL rule; accountant to confirm).
    if (!e.invoiceRef?.trim() || !/^3\d{13}3$/.test(e.supplierVatNo?.trim() ?? '')) {
      throw new DomainError('VALIDATION', "Recoverable VAT needs the supplier's invoice number and 15-digit VAT number (starts and ends with 3)");
    }
  }
  if ((e.periodStart === undefined) !== (e.periodEnd === undefined)) throw new DomainError('VALIDATION', 'Give both the first and last month of the service period');
  if (e.periodStart && e.periodEnd) {
    if (!MONTH.test(e.periodStart) || !MONTH.test(e.periodEnd) || e.periodEnd < e.periodStart) throw new DomainError('VALIDATION', 'Service period months must be YYYY-MM, first before last');
    months(e.periodStart, e.periodEnd);
  }
  const cat = ctx.db.prepare('SELECT active FROM expense_categories WHERE id = ?').get(e.categoryId) as { active: number } | undefined;
  if (!cat) throw new DomainError('NOT_FOUND', 'Category not found');
}

// ── drafts ──────────────────────────────────────────────────

/** Creates a draft expense (not in the books until posted). Re-sending the same request key returns the same draft. */
export function createExpense(ctx: Ctx, userId: number, input: ExpenseInput): number {
  requirePermission(ctx, userId, 'expense.create');
  if (!/^[\w-]{8,64}$/.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  validate(ctx, input);
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id FROM expenses WHERE request_key = ?').get(input.requestKey) as { id: number } | undefined;
    if (done) return done.id;
    return insertExpense(ctx, userId, input, null, null, true);
  })();
}

function insertExpense(ctx: Ctx, userId: number, e: ExpenseInput, recurringId: number | null, period: string | null, confirmed: boolean): number {
  const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'EXP' RETURNING next_value - 1 AS v").get() as { v: number }).v;
  const no = `EXP-${String(n).padStart(6, '0')}`;
  const now = ctx.now();
  const id = Number(
    ctx.db
      .prepare(
        `INSERT INTO expenses (expense_no, request_key, category_id, description, payee, invoice_ref, supplier_vat_no, notes, attachment_ref,
           expense_date, due_date, period_start, period_end, gross, vat_class, vat_amount, vat_recoverable, amount_confirmed, status,
           recurring_id, recurring_period, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(no, e.requestKey, e.categoryId, e.description.trim(), e.payee?.trim() || null, e.invoiceRef?.trim() || null, e.supplierVatNo?.trim() || null,
        e.notes?.trim() || null, e.attachmentRef?.trim() || null, e.expenseDate, e.dueDate || null, e.periodStart ?? null, e.periodEnd ?? null,
        e.gross, e.vatClass, e.vatAmount, e.vatRecoverable ? 1 : 0, confirmed ? 1 : 0, recurringId, period, userId, now, now).lastInsertRowid,
  );
  appendAudit(ctx, { userId, action: 'expense.create', entity: 'expense', entityId: id, details: { no, gross: e.gross, recurringId, period } });
  return id;
}

/** Edits a draft. Posted expenses cannot be edited (database trigger); correct them with a reversal. */
export function updateDraft(ctx: Ctx, userId: number, id: number, input: Omit<ExpenseInput, 'requestKey'>): void {
  requirePermission(ctx, userId, 'expense.create');
  validate(ctx, input);
  ctx.db.transaction(() => {
    const before = getExpense(ctx, id);
    if (before.status !== 'draft') throw new DomainError('CONFLICT', 'Only drafts can be edited. Reverse a posted expense instead.');
    ctx.db
      .prepare(
        `UPDATE expenses SET category_id = ?, description = ?, payee = ?, invoice_ref = ?, supplier_vat_no = ?, notes = ?, attachment_ref = ?,
           expense_date = ?, due_date = ?, period_start = ?, period_end = ?, gross = ?, vat_class = ?, vat_amount = ?, vat_recoverable = ?,
           amount_confirmed = 1, updated_at = ? WHERE id = ? AND status = 'draft'`,
      )
      .run(input.categoryId, input.description.trim(), input.payee?.trim() || null, input.invoiceRef?.trim() || null, input.supplierVatNo?.trim() || null,
        input.notes?.trim() || null, input.attachmentRef?.trim() || null, input.expenseDate, input.dueDate || null, input.periodStart ?? null,
        input.periodEnd ?? null, input.gross, input.vatClass, input.vatAmount, input.vatRecoverable ? 1 : 0, ctx.now(), id);
    appendAudit(ctx, { userId, action: 'expense.edit', entity: 'expense', entityId: id, details: { before: { gross: before.gross, vat: before.vatAmount, date: before.expenseDate, category: before.categoryId }, after: { gross: input.gross, vat: input.vatAmount, date: input.expenseDate, category: input.categoryId } } });
  })();
}

export function cancelDraft(ctx: Ctx, userId: number, id: number, reason: string): void {
  requirePermission(ctx, userId, 'expense.create');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  ctx.db.transaction(() => {
    const r = ctx.db.prepare("UPDATE expenses SET status = 'cancelled', closed_by = ?, closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
      .run(userId, ctx.now(), reason.trim(), ctx.now(), id);
    if (r.changes === 0) throw new DomainError('CONFLICT', 'Only drafts can be cancelled');
    appendAudit(ctx, { userId, action: 'expense.cancel', entity: 'expense', entityId: id, details: { reason } });
  })();
}

// ── posting, payments, reversals ────────────────────────────

/** Posts (approves) a draft into the books. Optionally pays it in full in the same transaction ("paid immediately"). */
export function postExpense(ctx: Ctx, userId: number, id: number, payNow?: { requestKey: string; method: PayMethod; reference?: string }): void {
  requirePermission(ctx, userId, 'expense.approve');
  if (payNow) requirePermission(ctx, userId, 'expense.pay');
  ctx.db.transaction(() => {
    const e = getExpense(ctx, id);
    if (e.status !== 'draft') throw new DomainError('CONFLICT', `Expense ${e.expenseNo} is ${e.status}, not a draft`);
    if (!e.amountConfirmed) throw new DomainError('VALIDATION', 'Enter the actual amount from the bill before posting (variable recurring expense)');
    if (e.expenseDate > today(ctx)) throw new DomainError('VALIDATION', 'An expense dated in the future cannot be posted yet');
    const cat = ctx.db.prepare('SELECT account_code, kind, active FROM expense_categories WHERE id = ?').get(e.categoryId) as { account_code: string; kind: string; active: number };
    const vatToAsset = e.vatRecoverable ? e.vatAmount : 0;
    const cost = e.gross - vatToAsset;
    const prepaid = e.periodStart !== null && e.periodEnd !== null && months(e.periodStart, e.periodEnd).length > 1;
    if (prepaid && cat.kind === 'capital') throw new DomainError('VALIDATION', 'A capital purchase cannot have a service period');
    const target = prepaid ? '1300' : cat.account_code;
    ctx.db.prepare("UPDATE expenses SET status = 'posted', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(userId, ctx.now(), ctx.now(), id);
    postEntry(ctx, {
      date: e.expenseDate,
      sourceType: 'expense',
      sourceId: id,
      memo: `Expense ${e.expenseNo}: ${e.description}`,
      lines: [{ account: target, debit: cost }, { account: '2210', debit: vatToAsset }, { account: '2010', credit: e.gross }],
    });
    appendAudit(ctx, { userId, action: 'expense.post', entity: 'expense', entityId: id, details: { no: e.expenseNo, gross: e.gross, vat: e.vatAmount, recoverable: e.vatRecoverable, account: target } });
    if (prepaid) recognizePrepaid(ctx, userId, id);
    if (payNow) payExpenseTx(ctx, userId, id, { requestKey: payNow.requestKey, amount: e.gross, method: payNow.method, paidOn: today(ctx), reference: payNow.reference });
  })();
}

/** Monthly share of a prepaid expense: equal parts, the first months carry any leftover halalas. */
export function amortizationSchedule(cost: number, monthList: string[]): { month: string; amount: number }[] {
  const base = Math.floor(cost / monthList.length);
  let extra = cost - base * monthList.length;
  return monthList.map((month) => ({ month, amount: base + (extra-- > 0 ? 1 : 0) }));
}

/** Moves the due months of prepaid expenses from 1300 to the expense account. Each month at most once. */
export function recognizePrepaid(ctx: Ctx, userId: number | null, onlyExpenseId?: number): number {
  const thisMonth = today(ctx).slice(0, 7);
  const rows = ctx.db
    .prepare(
      `SELECT e.id, e.expense_no, e.expense_date, e.gross, e.vat_amount, e.vat_recoverable, e.period_start, e.period_end, c.account_code
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.status = 'posted' AND e.period_start IS NOT NULL AND e.period_start <> e.period_end ${onlyExpenseId ? 'AND e.id = ?' : ''}`,
    )
    .all(...(onlyExpenseId ? [onlyExpenseId] : [])) as { id: number; expense_no: string; expense_date: string; gross: number; vat_amount: number; vat_recoverable: number; period_start: string; period_end: string; account_code: string }[];
  let posted = 0;
  const run = () => {
    for (const r of rows) {
      const cost = r.gross - (r.vat_recoverable ? r.vat_amount : 0);
      for (const m of amortizationSchedule(cost, months(r.period_start, r.period_end))) {
        if (m.month > thisMonth) break;
        const exists = ctx.db.prepare('SELECT 1 FROM expense_amortization WHERE expense_id = ? AND month = ?').get(r.id, m.month);
        if (exists) continue;
        const aid = Number(ctx.db.prepare('INSERT INTO expense_amortization (expense_id, month, amount, created_at) VALUES (?, ?, ?, ?)').run(r.id, m.month, m.amount, ctx.now()).lastInsertRowid);
        postEntry(ctx, {
          date: `${m.month}-01` < r.expense_date ? r.expense_date : `${m.month}-01`, // never before the expense was recognised
          sourceType: 'expense_amort',
          sourceId: aid,
          memo: `Prepaid ${r.expense_no}: ${m.month}`,
          lines: [{ account: r.account_code, debit: m.amount }, { account: '1300', credit: m.amount }],
        });
        posted++;
      }
    }
  };
  if (ctx.db.inTransaction) run();
  else ctx.db.transaction(run)();
  if (posted && userId !== null) appendAudit(ctx, { userId, action: 'expense.amortize', entity: 'expense', entityId: onlyExpenseId ?? null, details: { months: posted } });
  return posted;
}

export interface PaymentInput {
  requestKey: string;
  amount: number;
  method: PayMethod;
  paidOn: string;
  reference?: string;
}

export function payExpense(ctx: Ctx, userId: number, id: number, p: PaymentInput): number {
  requirePermission(ctx, userId, 'expense.pay');
  return ctx.db.transaction(() => payExpenseTx(ctx, userId, id, p))();
}

function payExpenseTx(ctx: Ctx, userId: number, id: number, p: PaymentInput): number {
  if (!/^[\w-]{8,64}$/.test(p.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  const done = ctx.db.prepare('SELECT id FROM expense_payments WHERE request_key = ?').get(p.requestKey) as { id: number } | undefined;
  if (done) return done.id; // double-clicked "Pay": recorded once
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new DomainError('VALIDATION', 'Payment must be more than zero');
  if (!DAY.test(p.paidOn)) throw new DomainError('VALIDATION', 'Payment date must be YYYY-MM-DD');
  if (p.paidOn > today(ctx)) throw new DomainError('VALIDATION', 'Payment date cannot be in the future');
  const e = getExpense(ctx, id);
  if (e.status !== 'posted') throw new DomainError('CONFLICT', 'Only posted expenses can be paid. Post (approve) it first.');
  if (p.amount > e.outstanding) throw new DomainError('VALIDATION', `Only ${e.outstanding / 100} SAR is still owed on ${e.expenseNo}`);
  let shiftId: number | null = null;
  if (p.method === 'till') {
    shiftId = openShiftId(ctx);
    if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Paying from the till needs an open shift');
    if (p.paidOn !== today(ctx)) throw new DomainError('VALIDATION', 'Cash from the till is paid today');
  }
  const pid = Number(
    ctx.db
      .prepare('INSERT INTO expense_payments (request_key, expense_id, amount, method, paid_on, reference, shift_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.requestKey, id, p.amount, p.method, p.paidOn, p.reference?.trim() || null, shiftId, userId, ctx.now()).lastInsertRowid,
  );
  postEntry(ctx, {
    date: p.paidOn,
    sourceType: 'expense_payment',
    sourceId: pid,
    memo: `Payment for ${e.expenseNo}`,
    lines: [{ account: '2010', debit: p.amount }, { account: p.method === 'till' ? '1010' : '1030', credit: p.amount }],
  });
  appendAudit(ctx, { userId, action: 'expense.pay', entity: 'expense', entityId: id, details: { paymentId: pid, amount: p.amount, method: p.method } });
  return pid;
}

/** Reverses a payment (e.g. a bank transfer that bounced). The original payment row stays. */
export function reversePayment(ctx: Ctx, userId: number, paymentId: number, requestKey: string, reason: string): number {
  requirePermission(ctx, userId, 'expense.reverse');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id FROM expense_payments WHERE request_key = ?').get(requestKey) as { id: number } | undefined;
    if (done) return done.id;
    const p = ctx.db.prepare('SELECT id, expense_id, amount, method, reversed_of FROM expense_payments WHERE id = ?').get(paymentId) as
      | { id: number; expense_id: number; amount: number; method: PayMethod; reversed_of: number | null }
      | undefined;
    if (!p || p.amount < 0) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (ctx.db.prepare('SELECT 1 FROM expense_payments WHERE reversed_of = ?').get(p.id)) throw new DomainError('CONFLICT', 'This payment is already reversed');
    let shiftId: number | null = null;
    if (p.method === 'till') {
      shiftId = openShiftId(ctx);
      if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Returning cash to the till needs an open shift');
    }
    const rid = Number(
      ctx.db
        .prepare('INSERT INTO expense_payments (request_key, expense_id, amount, method, paid_on, shift_id, reversed_of, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(requestKey, p.expense_id, -p.amount, p.method, today(ctx), shiftId, p.id, reason.trim(), userId, ctx.now()).lastInsertRowid,
    );
    postEntry(ctx, {
      date: today(ctx),
      sourceType: 'expense_payment',
      sourceId: rid,
      memo: `Payment reversed: ${reason.trim()}`,
      lines: [{ account: p.method === 'till' ? '1010' : '1030', debit: p.amount }, { account: '2010', credit: p.amount }],
    });
    appendAudit(ctx, { userId, action: 'expense.payment_reversed', entity: 'expense', entityId: p.expense_id, details: { paymentId: p.id, amount: p.amount, reason } });
    return rid;
  })();
}

/**
 * Reverses a posted expense with nothing paid on it: one journal entry that exactly undoes its recognition and any
 * prepaid months already moved to expense. The expense stays visible as "reversed".
 */
export function reverseExpense(ctx: Ctx, userId: number, id: number, reason: string): void {
  requirePermission(ctx, userId, 'expense.reverse');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  ctx.db.transaction(() => {
    const e = getExpense(ctx, id);
    if (e.status !== 'posted') throw new DomainError('CONFLICT', 'Only posted expenses can be reversed');
    if (e.paid !== 0) throw new DomainError('CONFLICT', 'Reverse its payments first: money has been paid on this expense');
    const net = ctx.db
      .prepare(
        `SELECT a.code, SUM(l.debit) - SUM(l.credit) AS net FROM journal_lines l
         JOIN journal_entries j ON j.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         WHERE (j.source_type = 'expense' AND j.source_id = ?)
            OR (j.source_type = 'expense_amort' AND j.source_id IN (SELECT id FROM expense_amortization WHERE expense_id = ?))
         GROUP BY a.code`,
      )
      .all(id, id) as { code: string; net: number }[];
    const lines: PostingLine[] = net.filter((r) => r.net !== 0).map((r) => (r.net > 0 ? { account: r.code, credit: r.net } : { account: r.code, debit: -r.net }));
    ctx.db.prepare("UPDATE expenses SET status = 'reversed', closed_by = ?, closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?").run(userId, ctx.now(), reason.trim(), ctx.now(), id);
    postEntry(ctx, { date: today(ctx), sourceType: 'expense_reversal', sourceId: id, memo: `Reversal of ${e.expenseNo}: ${reason.trim()}`, lines });
    appendAudit(ctx, { userId, action: 'expense.reverse', entity: 'expense', entityId: id, details: { no: e.expenseNo, reason } });
  })();
}

// ── reading ─────────────────────────────────────────────────

const SELECT = `
  SELECT e.*, c.name_en AS category, c.kind AS category_kind,
         COALESCE((SELECT SUM(amount) FROM expense_payments p WHERE p.expense_id = e.id), 0) AS paid,
         cu.display_name AS created_by_name, pu.display_name AS posted_by_name, xu.display_name AS closed_by_name
  FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN users cu ON cu.id = e.created_by
  LEFT JOIN users pu ON pu.id = e.posted_by LEFT JOIN users xu ON xu.id = e.closed_by`;

type Raw = Record<string, unknown> & { id: number; gross: number; paid: number; status: ExpenseRow['status']; due_date: string | null };

function toRow(r: Raw, day: string): ExpenseRow {
  const outstanding = r.status === 'posted' ? r.gross - r.paid : 0;
  const payState =
    r.status !== 'posted' ? r.status
      : outstanding === 0 ? 'paid'
        : r.due_date !== null && r.due_date < day ? 'overdue'
          : r.paid > 0 ? 'partial' : 'unpaid';
  return {
    id: r.id, expenseNo: r.expense_no as string, categoryId: r.category_id as number, category: r.category as string,
    categoryKind: r.category_kind as ExpenseRow['categoryKind'], description: r.description as string, payee: r.payee as string | null,
    invoiceRef: r.invoice_ref as string | null, supplierVatNo: r.supplier_vat_no as string | null, notes: r.notes as string | null,
    attachmentRef: r.attachment_ref as string | null, expenseDate: r.expense_date as string, dueDate: r.due_date,
    periodStart: r.period_start as string | null, periodEnd: r.period_end as string | null, gross: r.gross, vatClass: r.vat_class as VatClass,
    vatAmount: r.vat_amount as number, vatRecoverable: r.vat_recoverable === 1, amountConfirmed: r.amount_confirmed === 1, status: r.status,
    recurringId: r.recurring_id as number | null, recurringPeriod: r.recurring_period as string | null, paid: r.paid, outstanding, payState,
    createdBy: r.created_by_name as string, postedBy: r.posted_by_name as string | null, closedBy: r.closed_by_name as string | null,
    closeReason: r.close_reason as string | null,
  };
}

export function getExpense(ctx: Ctx, id: number): ExpenseRow {
  const r = ctx.db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Raw | undefined;
  if (!r) throw new DomainError('NOT_FOUND', 'Expense not found');
  return toRow(r, today(ctx));
}

export interface ExpenseFilter {
  fromDay: string;
  toDay: string;
  categoryId?: number;
  payState?: string;
  payee?: string;
}

/** Expenses whose expense date is in the range (drafts included, so nothing is hidden from the owner). */
export function listExpenses(ctx: Ctx, userId: number, f: ExpenseFilter): ExpenseRow[] {
  requirePermission(ctx, userId, 'expense.view');
  const day = today(ctx);
  return (ctx.db.prepare(`${SELECT} WHERE e.expense_date >= ? AND e.expense_date <= ? ${f.categoryId ? 'AND e.category_id = ?' : ''} ORDER BY e.expense_date DESC, e.id DESC`)
    .all(f.fromDay, f.toDay, ...(f.categoryId ? [f.categoryId] : [])) as Raw[])
    .map((r) => toRow(r, day))
    .filter((r) => (!f.payState || r.payState === f.payState) && (!f.payee || (r.payee ?? '').toLowerCase().includes(f.payee.toLowerCase())));
}

export function expensePayments(ctx: Ctx, userId: number, id: number) {
  requirePermission(ctx, userId, 'expense.view');
  return ctx.db
    .prepare(`SELECT p.id, p.amount, p.method, p.paid_on AS paidOn, p.reference, p.reversed_of AS reversedOf, p.reason, u.display_name AS user,
                (SELECT 1 FROM expense_payments x WHERE x.reversed_of = p.id) AS reversed
              FROM expense_payments p JOIN users u ON u.id = p.user_id WHERE p.expense_id = ? ORDER BY p.id`)
    .all(id) as { id: number; amount: number; method: PayMethod; paidOn: string; reference: string | null; reversedOf: number | null; reason: string | null; user: string; reversed: number | null }[];
}

export interface ExpenseSummary {
  fromDay: string;
  toDay: string;
  /** Posted expenses recognised in the period (accrual basis, by expense date), gross incl. VAT. */
  totalPosted: number;
  netOfRecoverableVat: number;
  recoverableVat: number;
  /** Money actually paid in the period (cash basis, by payment date). */
  paidInPeriod: number;
  /** Still owed today on all posted expenses, and the overdue part. */
  outstandingNow: number;
  overdueNow: number;
  draftsCount: number;
  byCategory: { category: string; gross: number; count: number }[];
  byMonth: { month: string; gross: number }[];
  recurring: { name: string; period: string | null; expected: number; actual: number | null; status: string }[];
}

export function expenseSummary(ctx: Ctx, userId: number, fromDay: string, toDay: string): ExpenseSummary {
  requirePermission(ctx, userId, 'expense.view');
  const one = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { v: number }).v;
  const posted = "status IN ('posted')";
  const all = listExpenses(ctx, userId, { fromDay: '0000-01-01', toDay: '9999-12-31' }).filter((e) => e.status === 'posted');
  const twelve = ctx.db
    .prepare(`SELECT substr(expense_date, 1, 7) AS month, SUM(gross) AS gross FROM expenses WHERE ${posted} AND expense_date <= ? GROUP BY month ORDER BY month DESC LIMIT 12`)
    .all(toDay) as { month: string; gross: number }[];
  return {
    fromDay,
    toDay,
    totalPosted: one(`SELECT COALESCE(SUM(gross),0) AS v FROM expenses WHERE ${posted} AND expense_date BETWEEN ? AND ?`, fromDay, toDay),
    recoverableVat: one(`SELECT COALESCE(SUM(vat_amount),0) AS v FROM expenses WHERE ${posted} AND vat_recoverable = 1 AND expense_date BETWEEN ? AND ?`, fromDay, toDay),
    netOfRecoverableVat: one(`SELECT COALESCE(SUM(gross - CASE WHEN vat_recoverable = 1 THEN vat_amount ELSE 0 END),0) AS v FROM expenses WHERE ${posted} AND expense_date BETWEEN ? AND ?`, fromDay, toDay),
    paidInPeriod: one('SELECT COALESCE(SUM(amount),0) AS v FROM expense_payments WHERE paid_on BETWEEN ? AND ?', fromDay, toDay),
    outstandingNow: all.reduce((s, e) => s + e.outstanding, 0),
    overdueNow: all.filter((e) => e.payState === 'overdue').reduce((s, e) => s + e.outstanding, 0),
    draftsCount: one("SELECT count(*) AS v FROM expenses WHERE status = 'draft'"),
    byCategory: ctx.db
      .prepare(`SELECT c.name_en AS category, SUM(e.gross) AS gross, count(*) AS count FROM expenses e JOIN expense_categories c ON c.id = e.category_id
                WHERE e.${posted} AND e.expense_date BETWEEN ? AND ? GROUP BY c.id ORDER BY gross DESC`)
      .all(fromDay, toDay) as ExpenseSummary['byCategory'],
    byMonth: twelve.reverse(),
    recurring: (ctx.db
      .prepare(`SELECT r.name, e.recurring_period AS period, r.expected_gross AS expected,
                  CASE WHEN e.status = 'posted' THEN e.gross END AS actual, COALESCE(e.status, 'not generated') AS status
                FROM recurring_expenses r LEFT JOIN expenses e ON e.recurring_id = r.id AND e.expense_date BETWEEN ? AND ?
                WHERE r.active = 1 ORDER BY r.name, e.recurring_period`)
      .all(fromDay, toDay) as ExpenseSummary['recurring']),
  };
}

// ── recurring ───────────────────────────────────────────────

export interface RecurringInput {
  id?: number;
  name: string;
  categoryId: number;
  expectedGross: number;
  variableAmount: boolean;
  interval: 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate?: string;
  dueDay: number;
  payee?: string;
  vatClass: VatClass;
  vatRecoverable: boolean;
  active: boolean;
}

export function saveRecurring(ctx: Ctx, userId: number, r: RecurringInput): number {
  requirePermission(ctx, userId, 'expense.approve');
  if (!r.name.trim()) throw new DomainError('VALIDATION', 'Name is required');
  if (!Number.isSafeInteger(r.expectedGross) || r.expectedGross <= 0) throw new DomainError('VALIDATION', 'Expected amount must be more than zero');
  if (!DAY.test(r.startDate) || (r.endDate && (!DAY.test(r.endDate) || r.endDate < r.startDate))) throw new DomainError('VALIDATION', 'Check the start and end dates');
  if (!Number.isInteger(r.dueDay) || r.dueDay < 1 || r.dueDay > 28) throw new DomainError('VALIDATION', 'Due day must be 1–28');
  if (r.vatClass !== 'standard' && r.vatRecoverable) throw new DomainError('VALIDATION', 'Only standard-rated expenses have recoverable VAT');
  if (!ctx.db.prepare('SELECT 1 FROM expense_categories WHERE id = ?').get(r.categoryId)) throw new DomainError('NOT_FOUND', 'Category not found');
  return ctx.db.transaction(() => {
    const now = ctx.now();
    const vals = [r.name.trim(), r.categoryId, r.expectedGross, r.variableAmount ? 1 : 0, r.interval, r.startDate, r.endDate || null, r.dueDay,
      r.payee?.trim() || null, r.vatClass, r.vatRecoverable ? 1 : 0, r.active ? 1 : 0];
    let id: number;
    if (r.id) {
      const res = ctx.db.prepare(`UPDATE recurring_expenses SET name = ?, category_id = ?, expected_gross = ?, variable_amount = ?, interval = ?, start_date = ?,
          end_date = ?, due_day = ?, payee = ?, vat_class = ?, vat_recoverable = ?, active = ?, updated_at = ? WHERE id = ?`).run(...vals, now, r.id);
      if (res.changes === 0) throw new DomainError('NOT_FOUND', 'Recurring expense not found');
      id = r.id;
    } else {
      id = Number(ctx.db.prepare(`INSERT INTO recurring_expenses (name, category_id, expected_gross, variable_amount, interval, start_date, end_date, due_day,
          payee, vat_class, vat_recoverable, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...vals, userId, now, now).lastInsertRowid);
    }
    appendAudit(ctx, { userId, action: 'expense.recurring_saved', entity: 'recurring_expense', entityId: id, details: { name: r.name, expected: r.expectedGross, interval: r.interval } });
    return id;
  })();
}

export function listRecurring(ctx: Ctx, userId: number) {
  requirePermission(ctx, userId, 'expense.view');
  return ctx.db
    .prepare(`SELECT r.id, r.name, r.category_id AS categoryId, c.name_en AS category, r.expected_gross AS expectedGross, r.variable_amount = 1 AS variableAmount,
                r.interval, r.start_date AS startDate, r.end_date AS endDate, r.due_day AS dueDay, r.payee, r.vat_class AS vatClass,
                r.vat_recoverable = 1 AS vatRecoverable, r.active = 1 AS active
              FROM recurring_expenses r JOIN expense_categories c ON c.id = r.category_id ORDER BY r.name`)
    .all() as (Omit<RecurringInput, 'variableAmount' | 'vatRecoverable' | 'active'> & { id: number; category: string; variableAmount: number; vatRecoverable: number; active: number })[];
}

const STEP = { monthly: 1, quarterly: 3, yearly: 12 } as const;

/** Period keys and due dates of a recurring expense from its start up to (and including) `untilDay`. */
export function recurringPeriods(r: { interval: keyof typeof STEP; startDate: string; endDate?: string | null; dueDay: number }, untilDay: string): { period: string; dueDate: string }[] {
  const out: { period: string; dueDate: string }[] = [];
  let [y, m] = r.startDate.split('-').map(Number) as [number, number];
  for (let guard = 0; guard < 600; guard++) {
    const first = `${y}-${String(m).padStart(2, '0')}`;
    const due = `${first}-${String(r.dueDay).padStart(2, '0')}`;
    if (first + '-01' > untilDay || (r.endDate && first + '-01' > r.endDate)) break;
    const period = r.interval === 'monthly' ? first : r.interval === 'yearly' ? String(y) : `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    out.push({ period: r.interval === 'quarterly' ? `${period}@${first}` : period, dueDate: due < r.startDate ? r.startDate : due });
    m += STEP[r.interval];
    while (m > 12) { m -= 12; y++; }
  }
  return out;
}

/**
 * Creates DRAFT expenses for every recurring period that has started (up to 7 days ahead, as a reminder).
 * Never posts or pays anything. One draft per definition per period: the database refuses duplicates.
 */
export function generateRecurring(ctx: Ctx, userId: number): number {
  requirePermission(ctx, userId, 'expense.create');
  const until = storeDay(new Date(Date.parse(ctx.now()) + 7 * 86_400_000).toISOString());
  const defs = ctx.db.prepare('SELECT * FROM recurring_expenses WHERE active = 1').all() as {
    id: number; name: string; category_id: number; expected_gross: number; variable_amount: number; interval: keyof typeof STEP;
    start_date: string; end_date: string | null; due_day: number; payee: string | null; vat_class: VatClass; vat_recoverable: number;
  }[];
  let created = 0;
  ctx.db.transaction(() => {
    for (const d of defs) {
      for (const p of recurringPeriods({ interval: d.interval, startDate: d.start_date, endDate: d.end_date, dueDay: d.due_day }, until)) {
        if (ctx.db.prepare('SELECT 1 FROM expenses WHERE recurring_id = ? AND recurring_period = ?').get(d.id, p.period)) continue;
        insertExpense(ctx, userId, {
          requestKey: `recurring-${d.id}-${p.period}`,
          categoryId: d.category_id,
          description: `${d.name} ${p.period.split('@')[0]}`,
          payee: d.payee ?? undefined,
          expenseDate: p.dueDate,
          dueDate: p.dueDate,
          gross: d.expected_gross,
          vatClass: d.vat_class,
          vatAmount: 0, // the real VAT comes from the bill when the draft is completed
          vatRecoverable: false,
        }, d.id, p.period, d.variable_amount === 0 && d.vat_class !== 'standard'); // VAT or a variable amount must be checked on the real bill
        created++;
      }
    }
  })();
  return created;
}

/** Cash paid out of a shift's till for expenses (net of reversals), for the shift's expected cash. */
export function tillExpensePayments(ctx: Ctx, shiftId: number): number {
  return (ctx.db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM expense_payments WHERE shift_id = ? AND method = 'till'").get(shiftId) as { v: number }).v;
}
