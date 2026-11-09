// Store expenses and financial statements (ADR-4, ADR-5). Accounting is PROVISIONAL until the accountant approves.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import {
  amortizationSchedule, cancelDraft, createExpense, expenseSummary, generateRecurring, getExpense, listCategories, listExpenses,
  payExpense, postExpense, recognizePrepaidMonth, recurringPeriods, reverseExpense, reversePayment, saveCategory, saveRecurring, updateDraft, type ExpenseInput,
} from './expenses';
import { balanceSheet, datedTrialBalance, generalLedger, ownerKpis, profitAndLoss } from './financials';
import { receiveGoods } from './inventory';
import { unbalancedEntries } from './ledger';
import { createSupplier } from './parties';
import { createRefund } from './refunds';
import { recordWastage } from './adjustments';
import { finalizeSale } from './sales';
import { openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let cat: Record<string, number>;
let k = 0;
const key = () => `exp-key-${++k}-xxxx`;
const DAY = 86_400_000;
const TODAY = '2026-11-05';

const err = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};
const acct = (code: string, from = '2000-01-01', to = '2099-12-31') => {
  const r = datedTrialBalance(ctx, u.admin, from, to).rows.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const exp = (o: Partial<ExpenseInput> = {}): ExpenseInput => ({
  requestKey: key(), categoryId: cat.Rent!, description: 'Rent November', payee: 'Landlord', expenseDate: TODAY,
  gross: 500_000, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false, ...o,
});
const draft = (o: Partial<ExpenseInput> = {}) => createExpense(ctx, u.admin, exp(o));
const books = () => {
  expect(unbalancedEntries(ctx)).toEqual([]);
  const tb = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31');
  expect(tb.totalDebit).toBe(tb.totalCredit);
  expect(balanceSheet(ctx, u.admin, '2099-12-31').balanced).toBe(true);
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  cat = Object.fromEntries(listCategories(ctx, u.admin).map((c) => [c.nameEn, c.id]));
});
afterEach(() => t.cleanup());

describe('expenses: everyday cases', () => {
  it('rent paid immediately from the bank: expense, then payment; payable nets to zero', () => {
    const id = draft();
    postExpense(ctx, u.admin, id, { requestKey: key(), method: 'bank', reference: 'TRX-1' });
    expect(getExpense(ctx, id)).toMatchObject({ status: 'posted', paid: 500_000, outstanding: 0, payState: 'paid' });
    expect(acct('6100')).toBe(500_000);
    expect(acct('1030')).toBe(-500_000);
    expect(acct('2010')).toBe(0);
    books();
  });

  it('electricity received in October, paid half in November and the rest later; overdue while unpaid after the due date', () => {
    t.advance(-30 * DAY); // 2026-10-06
    const id = draft({ categoryId: cat.Electricity!, description: 'Electricity Oct', expenseDate: '2026-10-06', dueDate: '2026-10-20', gross: 120_000 });
    postExpense(ctx, u.admin, id);
    expect(getExpense(ctx, id).payState).toBe('unpaid');
    t.advance(30 * DAY); // 2026-11-05
    expect(getExpense(ctx, id).payState).toBe('overdue');
    payExpense(ctx, u.admin, id, { requestKey: key(), amount: 60_000, method: 'bank', paidOn: TODAY });
    expect(getExpense(ctx, id)).toMatchObject({ paid: 60_000, outstanding: 60_000, payState: 'overdue' });
    expect(acct('2010')).toBe(-60_000); // still owed (credit balance)
    // P&L: the cost is in October (when incurred), the payment in November does not change profit
    expect(profitAndLoss(ctx, u.admin, '2026-10-01', '2026-10-31').totalOperating).toBe(120_000);
    expect(profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-30').totalOperating).toBe(0);
    const s = expenseSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
    expect(s).toMatchObject({ totalPosted: 0, paidInPeriod: 60_000, outstandingNow: 60_000, overdueNow: 60_000 });
    payExpense(ctx, u.admin, id, { requestKey: key(), amount: 60_000, method: 'bank', paidOn: TODAY });
    expect(getExpense(ctx, id).payState).toBe('paid');
    books();
  });

  it('cannot overpay; a double-clicked payment is recorded once; only posted expenses can be paid', () => {
    const id = draft({ gross: 10_000 });
    expect(err(() => payExpense(ctx, u.admin, id, { requestKey: key(), amount: 10_000, method: 'bank', paidOn: TODAY }))).toBe('CONFLICT');
    postExpense(ctx, u.admin, id);
    expect(err(() => payExpense(ctx, u.admin, id, { requestKey: key(), amount: 10_001, method: 'bank', paidOn: TODAY }))).toBe('VALIDATION');
    const rk = key();
    const a = payExpense(ctx, u.admin, id, { requestKey: rk, amount: 4_000, method: 'bank', paidOn: TODAY });
    const b = payExpense(ctx, u.admin, id, { requestKey: rk, amount: 4_000, method: 'bank', paidOn: TODAY });
    expect(b).toBe(a);
    expect(getExpense(ctx, id).paid).toBe(4_000);
  });

  it('drafts can be edited and cancelled; posted expenses cannot be edited, even directly in the database', () => {
    const id = draft();
    updateDraft(ctx, u.admin, id, { ...exp({ gross: 450_000 }) });
    expect(getExpense(ctx, id).gross).toBe(450_000);
    postExpense(ctx, u.admin, id);
    expect(err(() => updateDraft(ctx, u.admin, id, exp({ gross: 1 })))).toBe('CONFLICT');
    expect(() => ctx.db.prepare('UPDATE expenses SET gross = 1 WHERE id = ?').run(id)).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM expenses WHERE id = ?').run(id)).toThrow(/never deleted/);
    const d2 = draft();
    cancelDraft(ctx, u.admin, d2, 'entered twice');
    expect(getExpense(ctx, d2).status).toBe('cancelled');
    expect(err(() => postExpense(ctx, u.admin, d2))).toBe('CONFLICT');
  });

  it('reversal: refused while money is paid; after reversing the payment, the expense reverses to zero', () => {
    const id = draft({ gross: 30_000 });
    postExpense(ctx, u.admin, id);
    const pid = payExpense(ctx, u.admin, id, { requestKey: key(), amount: 30_000, method: 'bank', paidOn: TODAY });
    expect(err(() => reverseExpense(ctx, u.admin, id, 'wrong supplier'))).toBe('CONFLICT');
    reversePayment(ctx, u.admin, pid, key(), 'transfer bounced');
    expect(err(() => reversePayment(ctx, u.admin, pid, key(), 'again'))).toBe('CONFLICT');
    reverseExpense(ctx, u.admin, id, 'wrong supplier');
    expect(getExpense(ctx, id)).toMatchObject({ status: 'reversed', paid: 0, outstanding: 0 });
    for (const c of ['6100', '2010', '1030']) expect([c, acct(c)]).toEqual([c, 0]);
    books();
  });

  it('cannot post an expense dated in the future', () => {
    const id = draft({ expenseDate: '2026-12-01' });
    expect(err(() => postExpense(ctx, u.admin, id))).toBe('VALIDATION');
  });

  it('a failure while posting saves nothing (all or nothing)', () => {
    const id = draft();
    ctx.db.prepare("UPDATE accounts SET is_postable = 0 WHERE code = '6100'").run(); // simulate a broken account mapping
    expect(err(() => postExpense(ctx, u.admin, id, { requestKey: key(), method: 'bank' }))).toBe('VALIDATION');
    expect(getExpense(ctx, id)).toMatchObject({ status: 'draft', paid: 0 });
    expect((ctx.db.prepare("SELECT count(*) AS n FROM journal_entries WHERE source_type LIKE 'expense%'").get() as { n: number }).n).toBe(0);
  });
});

describe('expenses: VAT classes (provisional rules)', () => {
  it('recoverable VAT goes to input VAT, and needs the invoice number and supplier VAT number', () => {
    const base = { categoryId: cat.Maintenance! ?? cat['Maintenance and repairs']!, vatClass: 'standard' as const, gross: 11_500, vatAmount: 1_500, vatRecoverable: true };
    expect(err(() => draft({ ...base, categoryId: cat['Maintenance and repairs']! }))).toBe('VALIDATION');
    const id = draft({ ...base, categoryId: cat['Maintenance and repairs']!, invoiceRef: 'INV-77', supplierVatNo: '300000000000003' });
    postExpense(ctx, u.admin, id);
    expect(acct('6310')).toBe(10_000);
    expect(acct('2210')).toBe(1_500);
    expect(expenseSummary(ctx, u.admin, TODAY, TODAY)).toMatchObject({ totalPosted: 11_500, recoverableVat: 1_500, netOfRecoverableVat: 10_000 });
  });

  it('non-recoverable VAT stays part of the expense; zero/exempt/out-of-scope cannot carry VAT', () => {
    const id = draft({ categoryId: cat.Cleaning!, vatClass: 'standard', gross: 11_500, vatAmount: 1_500, vatRecoverable: false });
    postExpense(ctx, u.admin, id);
    expect(acct('6300')).toBe(11_500);
    expect(acct('2210')).toBe(0);
    expect(err(() => draft({ vatClass: 'zero', vatAmount: 100 }))).toBe('VALIDATION');
    expect(err(() => draft({ vatClass: 'exempt', vatRecoverable: true }))).toBe('VALIDATION');
  });
});

describe('expenses: prepaid, capital, till', () => {
  it('annual rent paid up front is spread over 12 months; only started months reach the P&L', () => {
    const id = draft({ description: 'Rent 2026-11..2027-10', gross: 1_200_001, periodStart: '2026-11', periodEnd: '2027-10' });
    postExpense(ctx, u.admin, id, { requestKey: key(), method: 'bank' });
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 100_001 });
    expect(acct('1300')).toBe(1_200_001 - 100_001); // November recognised (first month carries the extra halala)
    expect(profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-30').totalOperating).toBe(100_001);
    t.advance(31 * DAY); // December
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-12', requestKey: key(), expectedTotal: 100_000 });
    expect(profitAndLoss(ctx, u.admin, '2026-12-01', '2026-12-31').totalOperating).toBe(100_000);
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-12', requestKey: key(), expectedTotal: 0 }); // running again never recognises a month twice
    expect(acct('1300')).toBe(1_200_001 - 100_001 - 100_000);
    expect(amortizationSchedule(1_200_001, Array.from({ length: 12 }, (_, i) => String(i))).reduce((s, m) => s + m.amount, 0)).toBe(1_200_001);
    books();
  });

  it('reversing a prepaid expense undoes the months already recognised', () => {
    const id = draft({ gross: 300_000, periodStart: '2026-10', periodEnd: '2026-12' });
    t.advance(0);
    postExpense(ctx, u.admin, id);
    reverseExpense(ctx, u.admin, id, 'contract cancelled');
    for (const c of ['1300', '6100', '2010']) expect([c, acct(c)]).toEqual([c, 0]);
    books();
  });

  it('equipment is a capital purchase: an asset, not an operating expense', () => {
    const id = draft({ categoryId: cat['Equipment purchase (capital)']!, description: 'Fridge', gross: 800_000 });
    postExpense(ctx, u.admin, id);
    expect(acct('1500')).toBe(800_000);
    expect(profitAndLoss(ctx, u.admin, TODAY, TODAY).totalOperating).toBe(0);
  });

  it('paying from the till needs an open shift and reduces the expected drawer cash', () => {
    const id = draft({ categoryId: cat.Cleaning!, gross: 5_000 });
    postExpense(ctx, u.admin, id);
    expect(err(() => payExpense(ctx, u.admin, id, { requestKey: key(), amount: 5_000, method: 'till', paidOn: TODAY }))).toBe('NO_OPEN_SHIFT');
    const sh = openShift(ctx, u.cashier, 20_000);
    payExpense(ctx, u.admin, id, { requestKey: key(), amount: 5_000, method: 'till', paidOn: TODAY });
    expect(shiftSummary(ctx, sh)).toMatchObject({ tillExpenses: 5_000, expectedCash: 15_000 });
    expect(acct('1010')).toBe(-5_000);
  });
});

describe('recurring expenses', () => {
  it('generates one draft per period, never twice, never posted or paid', () => {
    saveRecurring(ctx, u.admin, { name: 'Internet', categoryId: cat.Internet!, expectedGross: 30_000, variableAmount: false, interval: 'monthly',
      startDate: '2026-09-01', dueDay: 10, payee: 'ISP', vatClass: 'out_of_scope', vatRecoverable: false, active: true });
    expect(generateRecurring(ctx, u.admin)).toBe(3); // Sep, Oct, Nov
    expect(generateRecurring(ctx, u.admin)).toBe(0);
    const rows = listExpenses(ctx, u.admin, { fromDay: '2026-01-01', toDay: '2026-12-31' });
    expect(rows.map((r) => [r.recurringPeriod, r.status, r.expenseDate])).toEqual([
      ['2026-11', 'draft', '2026-11-10'], ['2026-10', 'draft', '2026-10-10'], ['2026-09', 'draft', '2026-09-10'],
    ]);
    expect(acct('6130')).toBe(0);
  });

  it('variable amounts (electricity) must be confirmed from the real bill before posting', () => {
    saveRecurring(ctx, u.admin, { name: 'Electricity', categoryId: cat.Electricity!, expectedGross: 100_000, variableAmount: true, interval: 'monthly',
      startDate: '2026-11-01', dueDay: 1, vatClass: 'out_of_scope', vatRecoverable: false, active: true });
    generateRecurring(ctx, u.admin);
    const [e] = listExpenses(ctx, u.admin, { fromDay: '2026-11-01', toDay: '2026-11-30' });
    expect(err(() => postExpense(ctx, u.admin, e!.id))).toBe('VALIDATION');
    updateDraft(ctx, u.admin, e!.id, { categoryId: e!.categoryId, description: e!.description, expenseDate: e!.expenseDate, gross: 87_345, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false });
    postExpense(ctx, u.admin, e!.id);
    const s = expenseSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
    expect(s.recurring).toEqual([{ name: 'Electricity', period: '2026-11', expected: 100_000, actual: 87_345, status: 'posted' }]);
  });

  it('quarterly and yearly periods', () => {
    expect(recurringPeriods({ interval: 'quarterly', startDate: '2026-01-15', dueDay: 5 }, '2026-11-05').map((p) => p.period)).toEqual(['2026-Q1@2026-01', '2026-Q2@2026-04', '2026-Q3@2026-07', '2026-Q4@2026-10']);
    expect(recurringPeriods({ interval: 'yearly', startDate: '2025-03-01', dueDay: 1, endDate: '2026-12-31' }, '2030-01-01').map((p) => p.period)).toEqual(['2025', '2026']);
  });
});

describe('permissions', () => {
  it('cashier sees nothing; supervisor prepares drafts; only the owner posts, pays, reverses and sees the P&L', () => {
    expect(err(() => listExpenses(ctx, u.cashier, { fromDay: TODAY, toDay: TODAY }))).toBe('PERMISSION_DENIED');
    expect(err(() => createExpense(ctx, u.cashier, exp()))).toBe('PERMISSION_DENIED');
    const id = createExpense(ctx, u.supervisor, exp());
    expect(err(() => postExpense(ctx, u.supervisor, id))).toBe('PERMISSION_DENIED');
    expect(err(() => profitAndLoss(ctx, u.supervisor, TODAY, TODAY))).toBe('PERMISSION_DENIED');
    expect(err(() => saveCategory(ctx, u.supervisor, { nameEn: 'X', nameAr: 'X', accountCode: '6900', active: true }))).toBe('PERMISSION_DENIED');
    postExpense(ctx, u.admin, id);
    expect(err(() => payExpense(ctx, u.supervisor, id, { requestKey: key(), amount: 1, method: 'bank', paidOn: TODAY }))).toBe('PERMISSION_DENIED');
    expect(err(() => reverseExpense(ctx, u.supervisor, id, 'x'))).toBe('PERMISSION_DENIED');
  });

  it('categories are configurable but only map to expense accounts or equipment', () => {
    const id = saveCategory(ctx, u.admin, { nameEn: 'Pest control', nameAr: 'مكافحة الحشرات', accountCode: '6300', active: true });
    expect(listCategories(ctx, u.admin).find((c) => c.id === id)).toMatchObject({ kind: 'operating', accountCode: '6300' });
    expect(err(() => saveCategory(ctx, u.admin, { nameEn: 'Bad', nameAr: 'x', accountCode: '4000', active: true }))).toBe('VALIDATION');
    expect(err(() => saveCategory(ctx, u.admin, { nameEn: 'Pest control', nameAr: 'x', accountCode: '6300', active: true }))).toBe('CONFLICT');
  });
});

describe('financial statements reconcile with sales, refunds, stock and expenses', () => {
  it('P&L, balance sheet, trial balance, ledger and owner KPIs agree', () => {
    const milk = createProduct(ctx, u.admin, { sku: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1150, barcodes: ['6281000000137'] });
    const sup = createSupplier(ctx, u.admin, { name: 'S' });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: milk, qty: 100_000, unitCost: 600 }] });
    openShift(ctx, u.cashier, 0);
    const s1 = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: milk, qty: 10_000 }], payments: [{ tender: 'cash', amount: 11_500 }] });
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: milk, qty: 4_000, discount: 600 }], payments: [{ tender: 'card', amount: 4_000 }], discountApproverId: u.supervisor });
    createRefund(ctx, u.cashier, { requestKey: key(), invoiceNo: s1.invoiceNo, reason: 'r', lines: [{ saleLineNo: 1, qty: 2_000, restock: true }], approverId: u.supervisor });
    recordWastage(ctx, u.supervisor, { requestKey: key(), reason: 'Expired', lines: [{ productId: milk, qty: 1_000 }] });
    postExpense(ctx, u.admin, draft({ gross: 2_000 }), { requestKey: key(), method: 'bank' });

    const pl = profitAndLoss(ctx, u.admin, TODAY, TODAY);
    // sales excl. VAT: 115.00 -> 100.00 ; 40.00 (after 6.00 discount) -> 34.78 ; refund 2 of 10 -> 20.00 excl.
    expect(pl).toMatchObject({ salesGross: 13_478, returns: 2_000, netSales: 11_478, discountsGiven: 600 });
    const salesExcl = (ctx.db.prepare('SELECT SUM(total_excl) AS v FROM sales').get() as { v: number }).v;
    const refundsExcl = (ctx.db.prepare('SELECT SUM(total_excl) AS v FROM refunds').get() as { v: number }).v;
    expect(pl.netSales).toBe(salesExcl - refundsExcl);
    expect(pl.cogs).toBe(12 * 600); // 14 sold, 2 back on the shelf, at 6.00
    expect(pl.operating.map((o) => [o.code, o.amount])).toEqual([['5100', 600], ['6100', 2_000]]);
    expect(pl.netProfit).toBe(11_478 - 7_200 - 600 - 2_000);
    expect(pl.provisional).toBe(true);
    expect(pl.outputVat).toBe(acct('2200') * -1);
    const k = ownerKpis(ctx, u.admin, TODAY, TODAY);
    expect(k).toMatchObject({ saleCount: 2, salesInclVat: 15_500, refundsInclVat: 2_300, netSalesInclVat: 13_200, netSales: pl.netSales, grossProfit: pl.grossProfit, netProfit: pl.netProfit, cardRecorded: 4_000, cashCollected: 11_500 - 2_300 });
    expect(k.inventoryValue).toBe((100 - 14 + 2 - 1) * 600);
    const gl = generalLedger(ctx, u.admin, '4000', TODAY, TODAY);
    expect(gl.closing).toBe(pl.netSales);
    books();
  });
});
