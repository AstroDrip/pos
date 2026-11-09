import { roundDiv } from '../core/money';
import { nextDay, storeDay, storeDayStartUtc } from '../core/store-time';
import { DomainError, type Ctx } from './context';
import { dueSoonDays, openCreditInvoicesAll as receivablesAgeingAll } from './credit';
import { prepaidWaiting } from './expenses';
import { openSupplierItems, supplierControls } from './purchasing';
import { requirePermission } from './users';

// Financial statements from the journal (ADR-5). Accrual basis, by journal date (Saudi business day).
// One module feeds the desktop Accounting tab AND the owner dashboard snapshots, so they cannot disagree.
//
// KPI formulas (all halalas, VAT excluded unless the name says incl.):
//   netSales      = credits − debits on 4000 Sales revenue          (sales minus returns; discounts already netted)
//   salesGross    = 4000 credits from sales;  returns = 4000 debits from refunds
//   cogs          = debits − credits on 5000 Cost of goods sold    (weighted-average cost; refunds restocked reduce it)
//   grossProfit   = netSales − cogs
//   operating     = 5010 purchase differences and VAT not claimed + 5100 wastage/shrinkage + 6000 cash over/short + every 61xx–69xx expense account
//   netProfit     = grossProfit − operating                        (PROVISIONAL: draft chart, expenses may be missing)
//   cashCollected = cash tendered − change − cash refunds          (cash basis, from payment records)

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function checkRange(from: string, to: string) {
  if (!DAY.test(from) || !DAY.test(to)) throw new DomainError('VALIDATION', 'Dates must be YYYY-MM-DD');
  if (to < from) throw new DomainError('VALIDATION', '"To" date is before "From" date');
}

interface AccountNet {
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  debit: number;
  credit: number;
}

function accountTotals(ctx: Ctx, from: string | null, to: string): AccountNet[] {
  return ctx.db
    .prepare(
      `SELECT a.code, a.name_en AS nameEn, a.name_ar AS nameAr, a.type, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
         AND l.entry_id IN (SELECT id FROM journal_entries WHERE entry_date <= ? ${from ? 'AND entry_date >= ?' : ''})
       GROUP BY a.id ORDER BY a.code`,
    )
    .all(...(from ? [to, from] : [to])) as AccountNet[];
}

const sourceSum = (ctx: Ctx, code: string, side: 'debit' | 'credit', source: string, from: string, to: string) =>
  (ctx.db
    .prepare(
      `SELECT COALESCE(SUM(l.${side}),0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       WHERE a.code = ? AND j.source_type = ? AND j.entry_date BETWEEN ? AND ?`,
    )
    .get(code, source, from, to) as { v: number }).v;

export interface ProfitAndLoss {
  fromDay: string;
  toDay: string;
  basis: 'accrual';
  salesGross: number;
  returns: number;
  netSales: number;
  discountsGiven: number; // information only: already deducted inside netSales
  cogs: number;
  grossProfit: number;
  grossMarginBp: number | null;
  operating: { code: string; nameEn: string; nameAr: string; amount: number }[];
  totalOperating: number;
  netProfit: number;
  outputVat: number;
  inputVat: number;
  prepaidWaiting: number; // due and not yet recognised, so not in the expenses above
  entryCount: number; // 0 means no records for the period, which is different from a real zero result
  provisional: boolean;
  provisionalReasons: string[];
}

/** userId null = internal job (dashboard snapshots); IPC handlers always pass the logged-in user. */
export function profitAndLoss(ctx: Ctx, userId: number | null, from: string, to: string): ProfitAndLoss {
  if (userId !== null) requirePermission(ctx, userId, 'finance.view');
  checkRange(from, to);
  const t = accountTotals(ctx, from, to);
  const net = (code: string, side: 'dr' | 'cr') => {
    const a = t.find((x) => x.code === code);
    return a ? (side === 'dr' ? a.debit - a.credit : a.credit - a.debit) : 0;
  };
  const netSales = net('4000', 'cr');
  const cogs = net('5000', 'dr');
  const operating = t
    .filter((a) => a.type === 'expense' && a.code !== '5000' && (a.code === '5010' || a.code === '5100' || a.code >= '6000'))
    .map((a) => ({ code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, amount: a.debit - a.credit }))
    .filter((a) => a.amount !== 0);
  const totalOperating = operating.reduce((s, a) => s + a.amount, 0);
  const grossProfit = netSales - cogs;
  const reasons: string[] = [];
  const coa = ctx.db.prepare("SELECT value FROM settings WHERE key = 'coa_status'").get() as { value: string } | undefined;
  if (coa?.value !== 'approved') reasons.push('Chart of accounts not yet approved by the accountant');
  const drafts = (ctx.db.prepare("SELECT count(*) AS n FROM expenses WHERE status = 'draft' AND expense_date BETWEEN ? AND ?").get(from, to) as { n: number }).n;
  if (drafts > 0) reasons.push(`${drafts} draft expense(s) in this period are not posted yet`);
  const waiting = prepaidWaiting(ctx, to);
  if (waiting > 0) reasons.push('Some prepaid expenses that are due have not been recognised yet');
  reasons.push('No period close: later corrections can still change this period');
  return {
    fromDay: from,
    toDay: to,
    basis: 'accrual',
    salesGross: sourceSum(ctx, '4000', 'credit', 'sale', from, to),
    returns: sourceSum(ctx, '4000', 'debit', 'refund', from, to),
    netSales,
    discountsGiven: (ctx.db.prepare('SELECT COALESCE(SUM(total_discount),0) AS v FROM sales WHERE created_at >= ? AND created_at < ?').get(storeDayStartUtc(from), storeDayStartUtc(nextDay(to))) as { v: number }).v,
    cogs,
    grossProfit,
    grossMarginBp: netSales > 0 ? roundDiv(grossProfit * 10_000, netSales) : null,
    operating,
    totalOperating,
    netProfit: grossProfit - totalOperating,
    outputVat: net('2200', 'cr'),
    inputVat: net('2210', 'dr'),
    entryCount: (ctx.db.prepare('SELECT count(*) AS v FROM journal_entries WHERE entry_date BETWEEN ? AND ?').get(from, to) as { v: number }).v,
    prepaidWaiting: waiting,
    provisional: true,
    provisionalReasons: reasons,
  };
}

export interface BalanceSheet {
  asOf: string;
  assets: { code: string; nameEn: string; nameAr: string; amount: number }[];
  liabilities: { code: string; nameEn: string; nameAr: string; amount: number }[];
  equity: { code: string; nameEn: string; nameAr: string; amount: number }[];
  currentEarnings: number; // income − expenses to date (no year-end close yet)
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
  prepaidWaiting: number;
  entryCount: number;
}

export function balanceSheet(ctx: Ctx, userId: number, asOf: string): BalanceSheet {
  requirePermission(ctx, userId, 'finance.view');
  if (!DAY.test(asOf)) throw new DomainError('VALIDATION', 'Date must be YYYY-MM-DD');
  const t = accountTotals(ctx, null, asOf);
  const pick = (type: string, sign: 1 | -1) =>
    t.filter((a) => a.type === type).map((a) => ({ code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, amount: sign * (a.debit - a.credit) })).filter((a) => a.amount !== 0);
  const assets = pick('asset', 1);
  const liabilities = pick('liability', -1);
  const equity = pick('equity', -1);
  const income = t.filter((a) => a.type === 'income').reduce((s, a) => s + a.credit - a.debit, 0);
  const expense = t.filter((a) => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0);
  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const tle = liabilities.reduce((s, a) => s + a.amount, 0) + equity.reduce((s, a) => s + a.amount, 0) + (income - expense);
  return { asOf, assets, liabilities, equity, currentEarnings: income - expense, totalAssets, totalLiabilitiesAndEquity: tle, balanced: totalAssets === tle, prepaidWaiting: prepaidWaiting(ctx, asOf), entryCount: (ctx.db.prepare('SELECT count(*) AS v FROM journal_entries WHERE entry_date <= ?').get(asOf) as { v: number }).v };
}

export function datedTrialBalance(ctx: Ctx, userId: number, from: string, to: string) {
  requirePermission(ctx, userId, 'finance.view');
  checkRange(from, to);
  const rows = accountTotals(ctx, from, to).filter((a) => a.debit !== 0 || a.credit !== 0);
  return { rows, totalDebit: rows.reduce((s, r) => s + r.debit, 0), totalCredit: rows.reduce((s, r) => s + r.credit, 0) };
}

export function generalLedger(ctx: Ctx, userId: number, code: string, from: string, to: string) {
  requirePermission(ctx, userId, 'finance.view');
  checkRange(from, to);
  const acc = ctx.db.prepare('SELECT id, code, name_en AS nameEn, type FROM accounts WHERE code = ?').get(code) as { id: number; code: string; nameEn: string; type: string } | undefined;
  if (!acc) throw new DomainError('NOT_FOUND', 'Account not found');
  const debitNormal = acc.type === 'asset' || acc.type === 'expense';
  const open = ctx.db
    .prepare('SELECT COALESCE(SUM(l.debit),0) AS d, COALESCE(SUM(l.credit),0) AS c FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id WHERE l.account_id = ? AND j.entry_date < ?')
    .get(acc.id, from) as { d: number; c: number };
  let running = debitNormal ? open.d - open.c : open.c - open.d;
  const opening = running;
  const lines = (ctx.db
    .prepare(`SELECT j.entry_date AS date, j.source_type AS source, j.source_id AS sourceId, j.memo, l.debit, l.credit
              FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id WHERE l.account_id = ? AND j.entry_date BETWEEN ? AND ? ORDER BY j.entry_date, j.id, l.id`)
    .all(acc.id, from, to) as { date: string; source: string; sourceId: number; memo: string; debit: number; credit: number }[])
    .map((l) => ({ ...l, balance: (running += debitNormal ? l.debit - l.credit : l.credit - l.debit) }));
  return { account: acc, opening, closing: running, lines };
}

export interface OwnerKpis {
  fromDay: string;
  toDay: string;
  generatedAt: string;
  saleCount: number;
  salesInclVat: number; // receipts total incl. VAT
  refundsInclVat: number;
  netSalesInclVat: number;
  averageBasket: number | null;
  cashCollected: number; // cash basis
  cardRecorded: number; // card payments as recorded by cashiers (not verified with the bank)
  netSales: number; // excl. VAT, from the ledger
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  netProfitProvisional: true;
  outputVat: number;
  inventoryValue: number; // Inventory account balance (stock at weighted-average cost, as booked)
  expensesOutstanding: number; // 2010 balance today
  lowStockCount: number;
  /** Customer credit (accounts receivable) and supplier credit (accounts payable). Never part of cash. */
  receivablesOutstanding: number; // open customer invoices = 1100
  receivablesOverdue: number;
  receivablesDueSoon: number;
  customersWithBalance: number;
  customerAdvances: number; // money held for customers = 2300 (a liability)
  collectionsInPeriod: number; // customer payments received in the period (cash basis)
  payablesOutstanding: number; // open supplier items − unused return credits = 2000
  payablesOverdue: number;
  payablesDueSoon: number;
  suppliersWithBalance: number;
  supplierAdvances: number; // paid to suppliers in advance = 1310 (an asset)
  supplierPaymentsInPeriod: number;
  cashAndBank: number; // 1010 + 1020 + 1030 in the books (card clearing is money the bank still has to pay)
}

/** Owner KPIs for store days from..to. Uses the same P&L as the Accounting tab. */
/** Figures for a period only. Cheap enough to run for each day of a month. */
export function periodKpis(ctx: Ctx, userId: number | null, from: string, to: string) {
  const pl = profitAndLoss(ctx, userId, from, to);
  const f = storeDayStartUtc(from);
  const tt = storeDayStartUtc(nextDay(to));
  const one = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { v: number }).v;
  const saleCount = one('SELECT count(*) AS v FROM sales WHERE created_at >= ? AND created_at < ?', f, tt);
  const salesInclVat = one('SELECT COALESCE(SUM(total_incl),0) AS v FROM sales WHERE created_at >= ? AND created_at < ?', f, tt);
  const refundsInclVat = one('SELECT COALESCE(SUM(total_incl),0) AS v FROM refunds WHERE created_at >= ? AND created_at < ?', f, tt);
  const tendered = (k: string) => one('SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.tender = ? AND s.created_at >= ? AND s.created_at < ?', k, f, tt);
  const change = one('SELECT COALESCE(SUM(change_given),0) AS v FROM sales WHERE created_at >= ? AND created_at < ?', f, tt);
  return {
    fromDay: from,
    toDay: to,
    generatedAt: ctx.now(),
    saleCount,
    salesInclVat,
    refundsInclVat,
    netSalesInclVat: salesInclVat - refundsInclVat,
    averageBasket: saleCount ? roundDiv(salesInclVat, saleCount) : null,
    cashCollected: tendered('cash') - change - refundsInclVat,
    cardRecorded: tendered('card'),
    netSales: pl.netSales,
    cogs: pl.cogs,
    grossProfit: pl.grossProfit,
    operatingExpenses: pl.totalOperating,
    netProfit: pl.netProfit,
    netProfitProvisional: true as const,
    outputVat: pl.outputVat,
    pl,
  };
}

export function ownerKpis(ctx: Ctx, userId: number | null, from: string, to: string): OwnerKpis {
  const { pl, ...period } = periodKpis(ctx, userId, from, to);
  void pl;
  const f = storeDayStartUtc(from);
  const tt = storeDayStartUtc(nextDay(to));
  const one = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { v: number }).v;
  const ap = (ctx.db.prepare("SELECT COALESCE(SUM(l.credit) - SUM(l.debit),0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2010'").get() as { v: number }).v;
  return {
    ...period,
    // The Inventory account (1200) is the books' stock value. Quantity x average cost can differ from it by
    // rounding halalas, so the account balance is used.
    inventoryValue: (ctx.db.prepare("SELECT COALESCE(SUM(l.debit) - SUM(l.credit),0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1200'").get() as { v: number }).v,
    expensesOutstanding: ap,
    ...creditPosition(ctx, from, to, f, tt),
    lowStockCount: one('SELECT count(*) AS v FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id WHERE p.active = 1 AND COALESCE(b.qty,0) <= p.reorder_level'),
  };
}

export const todayStoreDay = (ctx: Ctx) => storeDay(ctx.now());

function creditPosition(ctx: Ctx, from: string, to: string, fUtc: string, tUtc: string) {
  const ar = receivablesAgeingAll(ctx);
  const day = storeDay(ctx.now());
  const soon = new Date(Date.parse(`${day}T00:00:00Z`) + dueSoonDays(ctx) * 86_400_000).toISOString().slice(0, 10);
  const sups = (ctx.db.prepare('SELECT id FROM suppliers').all() as { id: number }[]).map((r) => r.id);
  const supItems = sups.map((id) => openSupplierItems(ctx, id));
  const acct = (code: string) => (ctx.db.prepare('SELECT COALESCE(SUM(l.debit) - SUM(l.credit),0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').get(code) as { v: number }).v;
  const sum = (sql: string, ...a: unknown[]) => (ctx.db.prepare(sql).get(...a) as { v: number }).v;
  const sc = supplierControls(ctx);
  return {
    receivablesOutstanding: ar.reduce((s, i) => s + i.open, 0),
    receivablesOverdue: ar.filter((i) => i.dueDate !== null && i.dueDate < day).reduce((s, i) => s + i.open, 0),
    receivablesDueSoon: ar.filter((i) => i.dueDate !== null && i.dueDate >= day && i.dueDate <= soon).reduce((s, i) => s + i.open, 0),
    customersWithBalance: new Set(ar.map((i) => i.customerId)).size,
    customerAdvances: -acct('2300'),
    collectionsInPeriod: sum('SELECT COALESCE(SUM(amount),0) AS v FROM customer_receipts WHERE created_at >= ? AND created_at < ?', fUtc, tUtc),
    payablesOutstanding: sc.payablesOpen,
    payablesOverdue: supItems.flat().filter((i) => i.dueDate !== null && i.dueDate < day).reduce((s, i) => s + i.open, 0),
    payablesDueSoon: supItems.flat().filter((i) => i.dueDate !== null && i.dueDate >= day && i.dueDate <= soon).reduce((s, i) => s + i.open, 0),
    suppliersWithBalance: supItems.filter((items) => items.length > 0).length,
    supplierAdvances: sc.supplierAdvances,
    supplierPaymentsInPeriod: sum('SELECT COALESCE(SUM(amount),0) AS v FROM supplier_payments WHERE paid_on BETWEEN ? AND ?', from, to),
    cashAndBank: acct('1010') + acct('1020') + acct('1030'),
  };
}

export interface CashFlow {
  fromDay: string;
  toDay: string;
  opening: number;
  groups: { id: 'sales' | 'refunds' | 'customers' | 'suppliers' | 'expenses' | 'cash_moves' | 'differences' | 'other'; amount: number }[];
  net: number;
  closing: number;
}

const CASH_ACCOUNTS = "('1010', '1020', '1030')"; // the same three accounts as cashAndBank
const FLOW_GROUP: Record<string, CashFlow['groups'][number]['id']> = {
  sale: 'sales', refund: 'refunds', customer_receipt: 'customers', supplier_payment: 'suppliers',
  expense: 'expenses', expense_payment: 'expenses', expense_reversal: 'expenses', cash_movement: 'cash_moves', shift_close: 'differences',
};

/** Money that actually moved through cash and bank, by what caused it. Anything else lands in "other", so nothing is dropped. */
export function cashFlowData(ctx: Ctx, from: string, to: string): CashFlow {
  checkRange(from, to);
  const opening = (ctx.db
    .prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.entry_id WHERE a.code IN ${CASH_ACCOUNTS} AND j.entry_date < ?`)
    .get(from) as { v: number }).v;
  const rows = ctx.db
    .prepare(`SELECT j.source_type AS source, SUM(l.debit - l.credit) AS amount FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.entry_id
              WHERE a.code IN ${CASH_ACCOUNTS} AND j.entry_date BETWEEN ? AND ? GROUP BY j.source_type`)
    .all(from, to) as { source: string; amount: number }[];
  const totals: Record<CashFlow['groups'][number]['id'], number> = { sales: 0, refunds: 0, customers: 0, suppliers: 0, expenses: 0, cash_moves: 0, differences: 0, other: 0 };
  for (const r of rows) totals[FLOW_GROUP[r.source] ?? 'other'] += r.amount;
  const groups = (Object.keys(totals) as (keyof typeof totals)[]).map((id) => ({ id, amount: totals[id] }));
  const net = groups.reduce((s, g) => s + g.amount, 0);
  return { fromDay: from, toDay: to, opening, groups, net, closing: opening + net };
}

export function cashFlow(ctx: Ctx, userId: number, from: string, to: string): CashFlow {
  requirePermission(ctx, userId, 'finance.view');
  return cashFlowData(ctx, from, to);
}
