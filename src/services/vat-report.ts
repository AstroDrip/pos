import { nextDay, sqlStoreDay, storeDayStartUtc } from '../core/store-time';
import { DomainError, type Ctx } from './context';
import { requirePermission } from './users';
import { vatClaimsBetween, vatPendingBetween } from './vat-review';

// VAT summary for a period (Saudi business days), for the owner's accountant. PROVISIONAL:
//  - It is a working summary, NOT the official ZATCA VAT return form; the accountant files the return.
//  - Sales at 0% cannot be split into zero-rated and exempt: products only carry a rate. Shown as one line.
//  - Output VAT = VAT on sales − VAT on refunds. Input VAT = recoverable VAT on supplier invoices − on returns to
//    suppliers + recoverable VAT on expenses − on reversed expenses.
// The totals are checked against the VAT accounts in the journal (2200 output, 2210 input) and the result is shown.

export interface VatLine {
  net: number;
  vat: number;
}

export interface VatSummary {
  fromDay: string;
  toDay: string;
  salesStandard: VatLine;
  salesZeroOrExempt: VatLine;
  refundsStandard: VatLine;
  refundsZeroOrExempt: VatLine;
  purchasesRecoverable: VatLine;
  purchaseReturnsRecoverable: VatLine;
  expensesRecoverable: VatLine;
  expensesReversedRecoverable: VatLine;
  purchasesNonRecoverableVat: number; // VAT paid that cannot be reclaimed (cost, not input VAT)
  supplierVatClaims: number; // proforma VAT later claimed, less reversals, by claim date. Part of input VAT
  supplierVatPending: number; // VAT on proformas still under review. An estimate, not input VAT
  outputVat: number;
  inputVat: number;
  netVatDue: number; // positive = payable to ZATCA, negative = refundable
  ledgerOutputVat: number;
  ledgerInputVat: number;
  reconciles: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function vatSummary(ctx: Ctx, userId: number, from: string, to: string): VatSummary {
  requirePermission(ctx, userId, 'finance.view');
  if (!DAY.test(from) || !DAY.test(to) || to < from) throw new DomainError('VALIDATION', 'Check the dates');
  const f = storeDayStartUtc(from);
  const t = storeDayStartUtc(nextDay(to));
  const line = (sql: string, ...a: unknown[]): VatLine => {
    const r = ctx.db.prepare(sql).get(...a) as { net: number | null; vat: number | null };
    return { net: r.net ?? 0, vat: r.vat ?? 0 };
  };
  const salesStandard = line('SELECT SUM(l.line_excl) AS net, SUM(l.line_vat) AS vat FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.vat_rate_bp > 0 AND s.created_at >= ? AND s.created_at < ?', f, t);
  const salesZeroOrExempt = line('SELECT SUM(l.line_excl) AS net, 0 AS vat FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.vat_rate_bp = 0 AND s.created_at >= ? AND s.created_at < ?', f, t);
  const refundsStandard = line('SELECT SUM(l.line_excl) AS net, SUM(l.line_vat) AS vat FROM refund_lines l JOIN refunds r ON r.id = l.refund_id WHERE l.vat_rate_bp > 0 AND r.created_at >= ? AND r.created_at < ?', f, t);
  const refundsZeroOrExempt = line('SELECT SUM(l.line_excl) AS net, 0 AS vat FROM refund_lines l JOIN refunds r ON r.id = l.refund_id WHERE l.vat_rate_bp = 0 AND r.created_at >= ? AND r.created_at < ?', f, t);
  const purchasesRecoverable = line('SELECT SUM(invoice_net) AS net, SUM(vat_amount) AS vat FROM purchase_invoices WHERE vat_recoverable = 1 AND invoice_date BETWEEN ? AND ?', from, to);
  const purchaseReturnsRecoverable = line('SELECT SUM(credit_net) AS net, SUM(vat_amount) AS vat FROM purchase_returns WHERE vat_recoverable = 1 AND return_date BETWEEN ? AND ?', from, to);
  const expensesRecoverable = line("SELECT SUM(gross - vat_amount) AS net, SUM(vat_amount) AS vat FROM expenses WHERE status IN ('posted','reversed') AND vat_recoverable = 1 AND expense_date BETWEEN ? AND ?", from, to);
  const expensesReversedRecoverable = line(
    `SELECT SUM(gross - vat_amount) AS net, SUM(vat_amount) AS vat FROM expenses WHERE status = 'reversed' AND vat_recoverable = 1 AND ${sqlStoreDay('closed_at')} BETWEEN ? AND ?`, from, to);
  const nonRec =
    (ctx.db.prepare('SELECT COALESCE(SUM(vat_amount),0) AS v FROM purchase_invoices WHERE vat_recoverable = 0 AND invoice_date BETWEEN ? AND ?').get(from, to) as { v: number }).v -
    (ctx.db.prepare('SELECT COALESCE(SUM(vat_amount),0) AS v FROM purchase_returns WHERE vat_recoverable = 0 AND return_date BETWEEN ? AND ?').get(from, to) as { v: number }).v;
  const outputVat = salesStandard.vat - refundsStandard.vat;
  const supplierVatClaims = vatClaimsBetween(ctx, from, to);
  const inputVat = purchasesRecoverable.vat - purchaseReturnsRecoverable.vat + expensesRecoverable.vat - expensesReversedRecoverable.vat + supplierVatClaims;
  const ledger = (code: string) =>
    (ctx.db
      .prepare(`SELECT COALESCE(SUM(l.debit) - SUM(l.credit),0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN accounts a ON a.id = l.account_id
                WHERE a.code = ? AND j.entry_date BETWEEN ? AND ?`)
      .get(code, from, to) as { v: number }).v;
  const ledgerOutputVat = -ledger('2200');
  const ledgerInputVat = ledger('2210');
  return {
    fromDay: from,
    toDay: to,
    salesStandard,
    salesZeroOrExempt,
    refundsStandard,
    refundsZeroOrExempt,
    purchasesRecoverable,
    purchaseReturnsRecoverable,
    expensesRecoverable,
    expensesReversedRecoverable,
    purchasesNonRecoverableVat: nonRec,
    supplierVatClaims,
    supplierVatPending: vatPendingBetween(ctx, from, to),
    outputVat,
    inputVat,
    netVatDue: outputVat - inputVat,
    ledgerOutputVat,
    ledgerInputVat,
    reconciles: ledgerOutputVat === outputVat && ledgerInputVat === inputVat,
  };
}
