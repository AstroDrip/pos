import { storeDay } from '../core/store-time';
import { ageBucket, finStatus, suggestAllocation, type AgeBucket, type FinStatus } from '../core/status';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { postEntry, type PostingLine } from './ledger';
import { openShiftId } from './shifts';
import { rankCustomers } from './parties';
import { hasPermission, requirePermission } from './users';

// Customer credit = accounts receivable subledger (docs/audit/CREDIT_MANAGEMENT_AUDIT.md). PROVISIONAL accounting.
//  - A credit sale is an ordinary sale with tender 'account'; the sale entry debits 1100 for that part.
//  - Receipts: Dr cash/card/bank; Cr 1100 for what is allocated to invoices; Cr 2300 Customer advances for the rest.
//  - Advance applied later: Dr 2300 / Cr 1100.   Write-off: Dr 6910 / Cr 1100.
//  - Refund on an invoice with money owed: reduces the debt first (Cr 1100), cash only for the rest.
// Balances are always computed from these records; no stored running totals.

const KEY = /^[\w-]{8,64}$/;
const today = (ctx: Ctx) => storeDay(ctx.now());
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const METHOD_ACCOUNT = { cash: '1010', card: '1020', bank: '1030' } as const;
export type ReceiptMethod = keyof typeof METHOD_ACCOUNT;

export function dueSoonDays(ctx: Ctx): number {
  const v = Number((ctx.db.prepare("SELECT value FROM settings WHERE key = 'credit_due_soon_days'").get() as { value: string } | undefined)?.value);
  return Number.isSafeInteger(v) && v >= 0 ? v : 7;
}

// ── customer profile ────────────────────────────────────────

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  vat_number: string | null;
  credit_enabled: number;
  credit_limit: number | null;
  payment_terms_days: number | null;
  address: string | null;
  notes: string | null;
}

function customerRow(ctx: Ctx, id: number): CustomerRow {
  const c = ctx.db.prepare('SELECT id, name, phone, vat_number, credit_enabled, credit_limit, payment_terms_days, address, notes FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
  if (!c) throw new DomainError('NOT_FOUND', 'Customer not found');
  return c;
}

export interface CreditSettings {
  customerId: number;
  creditEnabled: boolean;
  creditLimit: number | null; // null = no fixed limit (trusted customer)
  paymentTermsDays: number | null; // null = no due date
  address?: string;
  notes?: string;
}

export function updateCustomerCredit(ctx: Ctx, userId: number, s: CreditSettings): void {
  requirePermission(ctx, userId, 'customer.credit.manage');
  if (s.creditLimit !== null && (!Number.isSafeInteger(s.creditLimit) || s.creditLimit < 0)) throw new DomainError('VALIDATION', 'Credit limit must be zero or more');
  if (s.paymentTermsDays !== null && (!Number.isSafeInteger(s.paymentTermsDays) || s.paymentTermsDays < 0 || s.paymentTermsDays > 365)) throw new DomainError('VALIDATION', 'Payment terms must be 0–365 days');
  ctx.db.transaction(() => {
    const before = customerRow(ctx, s.customerId);
    ctx.db
      .prepare('UPDATE customers SET credit_enabled = ?, credit_limit = ?, payment_terms_days = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(s.creditEnabled ? 1 : 0, s.creditLimit, s.paymentTermsDays, s.address?.trim() || null, s.notes?.trim() || null, ctx.now(), s.customerId);
    appendAudit(ctx, {
      userId,
      action: 'customer.credit_settings',
      entity: 'customer',
      entityId: s.customerId,
      details: {
        before: { enabled: before.credit_enabled === 1, limit: before.credit_limit, terms: before.payment_terms_days },
        after: { enabled: s.creditEnabled, limit: s.creditLimit, terms: s.paymentTermsDays },
      },
    });
  })();
}

// ── balances ───────────────────────────────────────────────

/** Open amount of every credit invoice (receivable), computed from the records. */
const OPEN_SQL = `
  SELECT r.sale_id AS saleId, s.invoice_no AS invoiceNo, s.created_at AS saleAt, s.total_incl AS saleTotal, r.amount, r.due_date AS dueDate, r.customer_id AS customerId,
         COALESCE((SELECT SUM(amount) FROM receipt_allocations a WHERE a.sale_id = r.sale_id), 0) AS allocated,
         COALESCE((SELECT SUM(amount) FROM customer_writeoffs w WHERE w.sale_id = r.sale_id), 0) AS writtenOff,
         COALESCE((SELECT SUM(amount) FROM refund_account_offsets o WHERE o.sale_id = r.sale_id), 0) AS refunded,
         COALESCE((SELECT disputed FROM invoice_disputes d WHERE d.sale_id = r.sale_id ORDER BY d.id DESC LIMIT 1), 0) AS disputed
  FROM receivables r JOIN sales s ON s.id = r.sale_id`;

export interface CreditInvoice {
  saleId: number;
  invoiceNo: string;
  saleAt: string;
  saleTotal: number; // whole bill incl. VAT
  amount: number; // left on account at the sale
  paidAtSale: number; // saleTotal − amount
  allocated: number; // later payments applied to it
  writtenOff: number;
  refunded: number; // refunds that reduced the debt
  open: number;
  dueDate: string | null;
  disputed: boolean;
  status: FinStatus;
  customerId: number;
}

function invoices(ctx: Ctx, where: string, ...args: unknown[]): CreditInvoice[] {
  const day = today(ctx);
  const soon = dueSoonDays(ctx);
  type Raw = { saleId: number; invoiceNo: string; saleAt: string; saleTotal: number; amount: number; dueDate: string | null; customerId: number; allocated: number; writtenOff: number; refunded: number; disputed: number };
  return (ctx.db.prepare(`${OPEN_SQL} ${where} ORDER BY COALESCE(r.due_date, '9999-12-31'), r.sale_id`).all(...args) as Raw[]).map((r) => {
    const open = r.amount - r.allocated - r.writtenOff - r.refunded;
    // The open amount counts from the whole bill: "paid" includes what was paid at the till.
    return {
      saleId: r.saleId, invoiceNo: r.invoiceNo, saleAt: r.saleAt, saleTotal: r.saleTotal, amount: r.amount, paidAtSale: r.saleTotal - r.amount,
      allocated: r.allocated, writtenOff: r.writtenOff, refunded: r.refunded, open, dueDate: r.dueDate, disputed: r.disputed === 1, customerId: r.customerId,
      status: finStatus({ total: r.saleTotal, open, dueDate: r.dueDate, today: day, dueSoonDays: soon, disputed: r.disputed === 1 }),
    };
  });
}

export const openInvoicesOf = (ctx: Ctx, customerId: number) => invoices(ctx, 'WHERE r.customer_id = ?', customerId).filter((i) => i.open > 0);
export const openCreditInvoicesAll = (ctx: Ctx) => invoices(ctx, '').filter((i) => i.open > 0);

/** Money received but not yet applied to any invoice (a customer advance, liability 2300). */
export function advanceOf(ctx: Ctx, customerId: number): number {
  const received = (ctx.db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM customer_receipts WHERE customer_id = ?').get(customerId) as { v: number }).v;
  const applied = (ctx.db.prepare('SELECT COALESCE(SUM(a.amount),0) AS v FROM receipt_allocations a JOIN customer_receipts c ON c.id = a.receipt_id WHERE c.customer_id = ?').get(customerId) as { v: number }).v;
  return received - applied;
}

function unappliedByReceipt(ctx: Ctx, customerId: number): { id: number; open: number }[] {
  return (ctx.db
    .prepare(`SELECT c.id, c.amount - COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.receipt_id = c.id), 0)
                - COALESCE((SELECT -x.amount FROM customer_receipts x WHERE x.reversed_of = c.id), 0) AS open
              FROM customer_receipts c WHERE c.customer_id = ? AND c.amount > 0 ORDER BY c.id`)
    .all(customerId) as { id: number; open: number }[]).filter((r) => r.open > 0);
}

export interface CreditCheck {
  enabled: boolean;
  limit: number | null;
  outstanding: number;
  advance: number;
  available: number | null; // null = no fixed limit
  proposed: number;
  newOutstanding: number;
  exceeds: boolean;
}

export function creditCheck(ctx: Ctx, customerId: number, proposed: number): CreditCheck {
  const c = customerRow(ctx, customerId);
  const outstanding = openInvoicesOf(ctx, customerId).reduce((s, i) => s + i.open, 0);
  const advance = advanceOf(ctx, customerId);
  const net = outstanding - advance;
  const available = c.credit_limit === null ? null : c.credit_limit - net;
  return {
    enabled: c.credit_enabled === 1,
    limit: c.credit_limit,
    outstanding,
    advance,
    available,
    proposed,
    newOutstanding: net + proposed,
    exceeds: available !== null && proposed > available,
  };
}

/** Called inside finalizeSale's transaction for the on-account part of a sale. */
export function checkCreditSale(ctx: Ctx, userId: number, customerId: number, amount: number, approverId?: number): { overrideBy: number | null; dueDate: string | null } {
  requirePermission(ctx, userId, 'customer.credit.sell');
  const c = customerRow(ctx, customerId);
  if (c.credit_enabled !== 1) throw new DomainError('PERMISSION_DENIED', `${c.name} is not allowed to buy on credit. The owner can enable credit for this customer.`);
  const chk = creditCheck(ctx, customerId, amount);
  let overrideBy: number | null = null;
  if (chk.exceeds) {
    if (approverId === undefined || !hasPermission(ctx, approverId, 'customer.credit.override')) {
      throw new DomainError('PERMISSION_DENIED', `Credit limit ${chk.limit! / 100} SAR: this sale takes the balance to ${chk.newOutstanding / 100} SAR (available ${Math.max(chk.available!, 0) / 100}). A supervisor must approve.`);
    }
    overrideBy = approverId;
  }
  return { overrideBy, dueDate: c.payment_terms_days === null ? null : addDays(today(ctx), c.payment_terms_days) };
}

// ── receipts and allocations ───────────────────────────────

export interface ReceiptInput {
  requestKey: string;
  customerId: number;
  amount: number;
  method: ReceiptMethod;
  reference?: string;
  notes?: string;
  /** Which invoices this payment settles. Anything not allocated becomes a customer advance. */
  allocations: { saleId: number; amount: number }[];
}

function checkAllocations(ctx: Ctx, customerId: number, allocs: { saleId: number; amount: number }[], maxTotal: number) {
  const open = new Map(openInvoicesOf(ctx, customerId).map((i) => [i.saleId, i]));
  const seen = new Set<number>();
  let total = 0;
  for (const a of allocs) {
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0) throw new DomainError('VALIDATION', 'Allocated amounts must be more than zero');
    if (seen.has(a.saleId)) throw new DomainError('VALIDATION', 'The same invoice is listed twice');
    seen.add(a.saleId);
    const inv = open.get(a.saleId);
    if (!inv) throw new DomainError('VALIDATION', 'That invoice has nothing owed, or belongs to another customer');
    if (a.amount > inv.open) throw new DomainError('VALIDATION', `${inv.invoiceNo}: only ${inv.open / 100} SAR is owed`);
    total += a.amount;
  }
  if (total > maxTotal) throw new DomainError('VALIDATION', 'Allocations add up to more than the payment');
  return total;
}

export function recordCustomerReceipt(ctx: Ctx, userId: number, input: ReceiptInput): { receiptId: number; receiptNo: string; allocated: number; advance: number; replayed: boolean } {
  requirePermission(ctx, userId, input.method === 'bank' ? 'customer.payment.bank' : 'customer.payment.record');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError('VALIDATION', 'Payment must be more than zero');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id, receipt_no FROM customer_receipts WHERE request_key = ?').get(input.requestKey) as { id: number; receipt_no: string } | undefined;
    if (done) {
      const alloc = (ctx.db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM receipt_allocations WHERE receipt_id = ?').get(done.id) as { v: number }).v;
      return { receiptId: done.id, receiptNo: done.receipt_no, allocated: alloc, advance: input.amount - alloc, replayed: true };
    }
    const c = customerRow(ctx, input.customerId);
    const allocated = checkAllocations(ctx, c.id, input.allocations, input.amount);
    let shiftId: number | null = null;
    if (input.method !== 'bank') {
      shiftId = openShiftId(ctx);
      if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Open a shift first: cash and card payments go into the till');
    }
    const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'CRCPT' RETURNING next_value - 1 AS v").get() as { v: number }).v;
    const receiptNo = `RC-${String(n).padStart(6, '0')}`;
    const now = ctx.now();
    const id = Number(ctx.db.prepare('INSERT INTO customer_receipts (receipt_no, request_key, customer_id, amount, method, reference, shift_id, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(receiptNo, input.requestKey, c.id, input.amount, input.method, input.reference?.trim() || null, shiftId, input.notes?.trim() || null, userId, now).lastInsertRowid);
    const ins = ctx.db.prepare("INSERT INTO receipt_allocations (receipt_id, sale_id, amount, kind, user_id, created_at) VALUES (?, ?, ?, 'at_receipt', ?, ?)");
    for (const a of input.allocations) ins.run(id, a.saleId, a.amount, userId, now);
    const advance = input.amount - allocated;
    postEntry(ctx, {
      date: today(ctx),
      sourceType: 'customer_receipt',
      sourceId: id,
      memo: `Payment ${receiptNo} from ${c.name}`,
      lines: [{ account: METHOD_ACCOUNT[input.method], debit: input.amount }, { account: '1100', credit: allocated }, { account: '2300', credit: advance }],
    });
    appendAudit(ctx, { userId, action: 'customer.payment', entity: 'customer', entityId: c.id, details: { receiptNo, amount: input.amount, method: input.method, allocations: input.allocations, advance } });
    return { receiptId: id, receiptNo, allocated, advance, replayed: false };
  })();
}

/** Applies money the customer already paid in advance to invoices: Dr 2300 / Cr 1100. */
export function applyCustomerAdvance(ctx: Ctx, userId: number, customerId: number, allocations: { saleId: number; amount: number }[]): number {
  requirePermission(ctx, userId, 'customer.payment.bank');
  return ctx.db.transaction(() => {
    const c = customerRow(ctx, customerId);
    const total = checkAllocations(ctx, customerId, allocations, advanceOf(ctx, customerId));
    if (total === 0) throw new DomainError('VALIDATION', 'Nothing to apply');
    const sources = unappliedByReceipt(ctx, customerId);
    const ins = ctx.db.prepare("INSERT INTO receipt_allocations (receipt_id, sale_id, amount, kind, user_id, created_at) VALUES (?, ?, ?, 'advance_applied', ?, ?)");
    for (const a of allocations) {
      let left = a.amount;
      for (const src of sources) {
        if (left === 0) break;
        const use = Math.min(left, src.open);
        if (use === 0) continue;
        const aid = Number(ins.run(src.id, a.saleId, use, userId, ctx.now()).lastInsertRowid);
        postEntry(ctx, { date: today(ctx), sourceType: 'customer_advance_applied', sourceId: aid, memo: `Advance applied for ${c.name}`, lines: [{ account: '2300', debit: use }, { account: '1100', credit: use }] });
        src.open -= use;
        left -= use;
      }
    }
    appendAudit(ctx, { userId, action: 'customer.advance_applied', entity: 'customer', entityId: customerId, details: { allocations } });
    return total;
  })();
}

/** Reverses a receipt (e.g. a bank transfer that bounced). Its allocations are undone; the original rows stay. */
export function reverseCustomerReceipt(ctx: Ctx, userId: number, receiptId: number, requestKey: string, reason: string): number {
  requirePermission(ctx, userId, 'customer.payment.reverse');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  if (!KEY.test(requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id FROM customer_receipts WHERE request_key = ?').get(requestKey) as { id: number } | undefined;
    if (done) return done.id;
    const r = ctx.db.prepare('SELECT id, receipt_no, customer_id, amount, method FROM customer_receipts WHERE id = ? AND amount > 0').get(receiptId) as
      | { id: number; receipt_no: string; customer_id: number; amount: number; method: ReceiptMethod }
      | undefined;
    if (!r) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (ctx.db.prepare('SELECT 1 FROM customer_receipts WHERE reversed_of = ?').get(r.id)) throw new DomainError('CONFLICT', 'This payment is already reversed');
    let shiftId: number | null = null;
    if (r.method !== 'bank') {
      shiftId = openShiftId(ctx);
      if (shiftId === null) throw new DomainError('NO_OPEN_SHIFT', 'Paying the money back from the till needs an open shift');
    }
    const n = (ctx.db.prepare("UPDATE invoice_counters SET next_value = next_value + 1 WHERE series = 'CRCPT' RETURNING next_value - 1 AS v").get() as { v: number }).v;
    const now = ctx.now();
    const rid = Number(ctx.db.prepare('INSERT INTO customer_receipts (receipt_no, request_key, customer_id, amount, method, shift_id, reversed_of, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`RC-${String(n).padStart(6, '0')}`, requestKey, r.customer_id, -r.amount, r.method, shiftId, r.id, reason.trim(), userId, now).lastInsertRowid);
    // Undo every allocation made from this receipt (at the time, or applied later as an advance).
    const allocs = ctx.db.prepare('SELECT sale_id, SUM(amount) AS amt FROM receipt_allocations WHERE receipt_id = ? GROUP BY sale_id HAVING amt <> 0').all(r.id) as { sale_id: number; amt: number }[];
    const ins = ctx.db.prepare("INSERT INTO receipt_allocations (receipt_id, sale_id, amount, kind, user_id, created_at) VALUES (?, ?, ?, 'reversal', ?, ?)");
    let allocated = 0;
    for (const a of allocs) {
      ins.run(r.id, a.sale_id, -a.amt, userId, now);
      allocated += a.amt;
    }
    postEntry(ctx, {
      date: today(ctx),
      sourceType: 'customer_receipt',
      sourceId: rid,
      memo: `Reversal of ${r.receipt_no}: ${reason.trim()}`,
      lines: [{ account: '1100', debit: allocated }, { account: '2300', debit: r.amount - allocated }, { account: METHOD_ACCOUNT[r.method], credit: r.amount }],
    });
    appendAudit(ctx, { userId, action: 'customer.payment_reversed', entity: 'customer', entityId: r.customer_id, details: { receiptNo: r.receipt_no, amount: r.amount, reason } });
    return rid;
  })();
}

export function writeOffInvoice(ctx: Ctx, userId: number, input: { requestKey: string; saleId: number; amount: number; reason: string }): number {
  requirePermission(ctx, userId, 'customer.writeoff');
  if (!KEY.test(input.requestKey)) throw new DomainError('VALIDATION', 'Invalid request key');
  if (!input.reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  return ctx.db.transaction(() => {
    const done = ctx.db.prepare('SELECT id FROM customer_writeoffs WHERE request_key = ?').get(input.requestKey) as { id: number } | undefined;
    if (done) return done.id;
    const [inv] = invoices(ctx, 'WHERE r.sale_id = ?', input.saleId);
    if (!inv) throw new DomainError('NOT_FOUND', 'Credit invoice not found');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > inv.open) throw new DomainError('VALIDATION', `Write-off must be between 0.01 and ${inv.open / 100} SAR`);
    const id = Number(ctx.db.prepare('INSERT INTO customer_writeoffs (request_key, sale_id, amount, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.requestKey, input.saleId, input.amount, input.reason.trim(), userId, ctx.now()).lastInsertRowid);
    postEntry(ctx, { date: today(ctx), sourceType: 'customer_writeoff', sourceId: id, memo: `Bad debt ${inv.invoiceNo}: ${input.reason.trim()}`, lines: [{ account: '6910', debit: input.amount }, { account: '1100', credit: input.amount }] });
    appendAudit(ctx, { userId, action: 'customer.writeoff', entity: 'sale', entityId: input.saleId, details: { invoiceNo: inv.invoiceNo, amount: input.amount, reason: input.reason } });
    return id;
  })();
}

export function setInvoiceDispute(ctx: Ctx, userId: number, saleId: number, disputed: boolean, note: string): void {
  requirePermission(ctx, userId, 'customer.credit.manage');
  if (!note.trim()) throw new DomainError('VALIDATION', 'A note is required');
  ctx.db.transaction(() => {
    if (!ctx.db.prepare('SELECT 1 FROM receivables WHERE sale_id = ?').get(saleId)) throw new DomainError('NOT_FOUND', 'Credit invoice not found');
    ctx.db.prepare('INSERT INTO invoice_disputes (sale_id, disputed, note, user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(saleId, disputed ? 1 : 0, note.trim(), userId, ctx.now());
    appendAudit(ctx, { userId, action: disputed ? 'customer.invoice_disputed' : 'customer.dispute_cleared', entity: 'sale', entityId: saleId, details: { note } });
  })();
}

/** For refunds: how much of a refund on this sale should reduce what the customer still owes (no cash paid for it). */
export function refundOffsetFor(ctx: Ctx, saleId: number, refundTotal: number): number {
  const [inv] = invoices(ctx, 'WHERE r.sale_id = ?', saleId);
  return inv ? Math.min(Math.max(inv.open, 0), refundTotal) : 0;
}

// ── reading: accounts, statements, ageing ──────────────────

export interface CustomerAccount {
  id: number;
  name: string;
  phone: string | null;
  vatNumber: string | null;
  address: string | null;
  notes: string | null;
  creditEnabled: boolean;
  creditLimit: number | null;
  paymentTermsDays: number | null;
  outstanding: number;
  advance: number;
  available: number | null;
  overdue: number;
  unpaidCount: number;
  partialCount: number;
  lifetimePurchases: number;
  lifetimePayments: number;
  lastPurchase: string | null;
  lastPayment: string | null;
  invoices: CreditInvoice[];
  receipts: { id: number; receiptNo: string; amount: number; method: string; reference: string | null; at: string; user: string; reversed: boolean; reversedOf: number | null; notes: string | null; allocations: { invoiceNo: string; amount: number }[] }[];
}

export function customerAccount(ctx: Ctx, userId: number, customerId: number): CustomerAccount {
  if (!hasPermission(ctx, userId, 'customer.statements') && !hasPermission(ctx, userId, 'customer.credit.sell')) requirePermission(ctx, userId, 'customer.statements');
  const c = customerRow(ctx, customerId);
  const all = invoices(ctx, 'WHERE r.customer_id = ?', customerId);
  const open = all.filter((i) => i.open > 0);
  const chk = creditCheck(ctx, customerId, 0);
  const one = (sql: string) => ctx.db.prepare(sql).get(customerId) as { v: number | string | null };
  const receipts = (ctx.db
    .prepare(`SELECT c.id, c.receipt_no AS receiptNo, c.amount, c.method, c.reference, c.created_at AS at, u.display_name AS user, c.reversed_of AS reversedOf, c.notes,
                (SELECT 1 FROM customer_receipts x WHERE x.reversed_of = c.id) AS reversed
              FROM customer_receipts c JOIN users u ON u.id = c.user_id WHERE c.customer_id = ? ORDER BY c.id DESC`)
    .all(customerId) as (Omit<CustomerAccount['receipts'][number], 'allocations' | 'reversed'> & { reversed: number | null })[]).map((r) => ({
    ...r,
    reversed: r.reversed === 1,
    allocations: ctx.db
      .prepare('SELECT s.invoice_no AS invoiceNo, SUM(a.amount) AS amount FROM receipt_allocations a JOIN sales s ON s.id = a.sale_id WHERE a.receipt_id = ? GROUP BY a.sale_id HAVING SUM(a.amount) <> 0')
      .all(r.id) as { invoiceNo: string; amount: number }[],
  }));
  return {
    id: c.id, name: c.name, phone: c.phone, vatNumber: c.vat_number, address: c.address, notes: c.notes,
    creditEnabled: c.credit_enabled === 1, creditLimit: c.credit_limit, paymentTermsDays: c.payment_terms_days,
    outstanding: chk.outstanding, advance: chk.advance, available: chk.available,
    overdue: open.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.open, 0),
    unpaidCount: open.filter((i) => i.open === i.amount).length,
    partialCount: open.filter((i) => i.open < i.amount).length,
    lifetimePurchases: (one('SELECT COALESCE(SUM(total_incl),0) AS v FROM sales WHERE customer_id = ?').v as number) - (one('SELECT COALESCE(SUM(r.total_incl),0) AS v FROM refunds r JOIN sales s ON s.id = r.original_sale_id WHERE s.customer_id = ?').v as number),
    lifetimePayments:
      (one("SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.customer_id = ? AND p.tender <> 'account'").v as number) -
      (one('SELECT COALESCE(SUM(change_given),0) AS v FROM sales WHERE customer_id = ?').v as number) +
      (one('SELECT COALESCE(SUM(amount),0) AS v FROM customer_receipts WHERE customer_id = ?').v as number),
    lastPurchase: one('SELECT MAX(created_at) AS v FROM sales WHERE customer_id = ?').v as string | null,
    lastPayment: one('SELECT MAX(created_at) AS v FROM customer_receipts WHERE customer_id = ? AND amount > 0').v as string | null,
    invoices: all,
    receipts,
  };
}

export interface StatementLine {
  at: string;
  description: string;
  ref: string;
  debit: number; // increases what the customer owes
  credit: number; // reduces it
  balance: number; // positive = customer owes the store; negative = store holds an advance
}

/**
 * Customer statement. Only credit invoices appear (a fully paid till sale never creates a debt). For each credit
 * invoice: the whole bill (debit) and what was paid at the till (credit), then receipts, refunds and write-offs.
 */
export function customerStatement(ctx: Ctx, userId: number, customerId: number): { customer: string; lines: StatementLine[]; balance: number } {
  requirePermission(ctx, userId, 'customer.statements');
  const c = customerRow(ctx, customerId);
  const rows = ctx.db
    .prepare(
      `SELECT s.created_at AS at, 'Credit sale' AS description, s.invoice_no AS ref, s.total_incl AS debit, 0 AS credit, 1 AS ord, s.id AS k
         FROM receivables r JOIN sales s ON s.id = r.sale_id WHERE r.customer_id = @c
       UNION ALL SELECT s.created_at, 'Paid at the till', s.invoice_no, 0, s.total_incl - r.amount, 2, s.id
         FROM receivables r JOIN sales s ON s.id = r.sale_id WHERE r.customer_id = @c AND s.total_incl > r.amount
       UNION ALL SELECT c.created_at, CASE WHEN c.amount > 0 THEN 'Payment' ELSE 'Payment reversed' END, c.receipt_no,
         CASE WHEN c.amount < 0 THEN -c.amount ELSE 0 END, CASE WHEN c.amount > 0 THEN c.amount ELSE 0 END, 3, c.id
         FROM customer_receipts c WHERE c.customer_id = @c
       UNION ALL SELECT f.created_at, 'Refund (taken off the account)', f.refund_no, 0, o.amount, 4, f.id
         FROM refund_account_offsets o JOIN refunds f ON f.id = o.refund_id JOIN receivables r ON r.sale_id = o.sale_id WHERE r.customer_id = @c
       UNION ALL SELECT w.created_at, 'Written off', s.invoice_no, 0, w.amount, 5, w.id
         FROM customer_writeoffs w JOIN receivables r ON r.sale_id = w.sale_id JOIN sales s ON s.id = w.sale_id WHERE r.customer_id = @c
       ORDER BY at, ord, k`,
    )
    .all({ c: customerId }) as { at: string; description: string; ref: string; debit: number; credit: number }[];
  let bal = 0;
  const lines = rows.map((r) => ({ ...r, balance: (bal += r.debit - r.credit) }));
  return { customer: c.name, lines, balance: bal };
}

export interface ArAgeingRow {
  customerId: number;
  customer: string;
  outstanding: number;
  advance: number;
  buckets: Record<AgeBucket, number>;
  mostOverdueInvoice: string | null;
  lastPayment: string | null;
}

export function receivablesAgeing(ctx: Ctx, userId: number, asOf?: string): ArAgeingRow[] {
  requirePermission(ctx, userId, 'customer.statements');
  const day = asOf ?? today(ctx);
  const byCustomer = new Map<number, ArAgeingRow>();
  const names = new Map((ctx.db.prepare('SELECT id, name FROM customers').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  for (const inv of invoices(ctx, '')) {
    if (inv.open <= 0) continue;
    const row = byCustomer.get(inv.customerId) ?? {
      customerId: inv.customerId, customer: names.get(inv.customerId) ?? '?', outstanding: 0, advance: 0,
      buckets: { noDue: 0, notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 }, mostOverdueInvoice: null, lastPayment: null,
    };
    row.outstanding += inv.open;
    row.buckets[ageBucket(inv.dueDate, day)] += inv.open;
    if (inv.dueDate !== null && inv.dueDate < day && row.mostOverdueInvoice === null) row.mostOverdueInvoice = inv.invoiceNo; // sorted by due date
    byCustomer.set(inv.customerId, row);
  }
  for (const id of (ctx.db.prepare('SELECT DISTINCT customer_id AS id FROM customer_receipts').all() as { id: number }[]).map((r) => r.id)) {
    const adv = advanceOf(ctx, id);
    if (adv === 0 && !byCustomer.has(id)) continue;
    const row = byCustomer.get(id) ?? { customerId: id, customer: names.get(id) ?? '?', outstanding: 0, advance: 0, buckets: { noDue: 0, notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 }, mostOverdueInvoice: null, lastPayment: null };
    row.advance = adv;
    byCustomer.set(id, row);
  }
  for (const row of byCustomer.values()) {
    row.lastPayment = (ctx.db.prepare('SELECT MAX(created_at) AS v FROM customer_receipts WHERE customer_id = ? AND amount > 0').get(row.customerId) as { v: string | null }).v;
  }
  return [...byCustomer.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export function suggestCustomerAllocation(ctx: Ctx, userId: number, customerId: number, amount: number) {
  requirePermission(ctx, userId, 'customer.payment.record');
  return suggestAllocation(openInvoicesOf(ctx, customerId).map((i) => ({ id: i.saleId, open: i.open })), amount).map((a) => ({ saleId: a.id, amount: a.amount }));
}

export function findCreditCustomers(ctx: Ctx, userId: number, text: string) {
  requirePermission(ctx, userId, 'customer.credit.sell');
  const t = text.trim().replace(/[%_]/g, '');
  if (!t) return [];
  const rows = ctx.db
    .prepare('SELECT id, name, phone FROM customers WHERE phone LIKE ? OR name LIKE ? OR CAST(id AS TEXT) = ? LIMIT 2000')
    .all(`%${t}%`, `%${t}%`, t) as { id: number; name: string; phone: string | null }[];
  return rankCustomers(ctx, rows, t).map((r) => creditCustomerRow(ctx, r.id));
}

function creditCustomerRow(ctx: Ctx, id: number) {
  const c = customerRow(ctx, id);
  const chk = creditCheck(ctx, id, 0);
  return { id: c.id, name: c.name, phone: c.phone, creditEnabled: c.credit_enabled === 1, limit: c.credit_limit, outstanding: chk.outstanding, advance: chk.advance, available: chk.available };
}

/** Every customer A to Z, one page at a time, with the same figures a search shows. */
export function listCustomerAccounts(ctx: Ctx, userId: number, q: { offset: number; limit: number }) {
  requirePermission(ctx, userId, 'customer.credit.sell');
  const total = (ctx.db.prepare('SELECT count(*) AS n FROM customers').get() as { n: number }).n;
  const rows = ctx.db.prepare('SELECT id FROM customers ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?').all(q.limit, q.offset) as { id: number }[];
  return { total, items: rows.map((r) => creditCustomerRow(ctx, r.id)) };
}

/** Control check: subledgers must equal their control accounts. Returns the differences (all 0 when correct). */
export function creditControls(ctx: Ctx) {
  const acct = (code: string) => (ctx.db.prepare('SELECT COALESCE(SUM(l.debit) - SUM(l.credit),0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').get(code) as { v: number }).v;
  const arOpen = invoices(ctx, '').reduce((s, i) => s + i.open, 0);
  const advances = (ctx.db.prepare('SELECT DISTINCT customer_id AS id FROM customer_receipts').all() as { id: number }[]).reduce((s, r) => s + advanceOf(ctx, r.id), 0);
  return {
    receivablesOpen: arOpen,
    receivablesControl: acct('1100'),
    customerAdvances: advances,
    customerAdvancesControl: -acct('2300'),
    ok: arOpen === acct('1100') && advances === -acct('2300'),
  };
}

export type { PostingLine };

/** Customer payment receipt content, from the stored receipt only. */
export function creditReceiptData(ctx: Ctx, receiptId: number) {
  const r = ctx.db
    .prepare(`SELECT c.receipt_no, c.created_at, c.amount, c.method, c.reference, c.customer_id, cu.name AS customer, u.display_name AS cashier
              FROM customer_receipts c JOIN customers cu ON cu.id = c.customer_id JOIN users u ON u.id = c.user_id WHERE c.id = ?`)
    .get(receiptId) as { receipt_no: string; created_at: string; amount: number; method: string; reference: string | null; customer_id: number; customer: string; cashier: string } | undefined;
  if (!r) throw new DomainError('NOT_FOUND', 'Payment not found');
  const allocations = ctx.db
    .prepare('SELECT s.invoice_no AS invoiceNo, SUM(a.amount) AS amount FROM receipt_allocations a JOIN sales s ON s.id = a.sale_id WHERE a.receipt_id = ? GROUP BY a.sale_id HAVING SUM(a.amount) <> 0')
    .all(receiptId) as { invoiceNo: string; amount: number }[];
  const chk = creditCheck(ctx, r.customer_id, 0);
  return {
    kind: 'payment' as const,
    invoiceNo: r.receipt_no,
    uuid: '',
    createdAt: r.created_at,
    cashier: r.cashier,
    customerName: r.customer,
    allocations,
    remainingOnAccount: chk.outstanding - chk.advance,
    lines: [],
    totalExcl: r.amount,
    totalVat: 0,
    totalIncl: r.amount,
    totalDiscount: 0,
    payments: [{ tender: r.method, amount: r.amount }],
    changeGiven: 0,
  };
}
