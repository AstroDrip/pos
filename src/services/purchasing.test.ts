// Purchasing (plan Phase 4) and the VAT summary. Posting rules are PROVISIONAL until the accountant approves.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { createExpense, listCategories, postExpense, reverseExpense } from './expenses';
import { balanceSheet, datedTrialBalance, profitAndLoss } from './financials';
import { receiveGoods, stockDrift } from './inventory';
import { unbalancedEntries } from './ledger';
import { createSupplier } from './parties';
import {
  createPurchaseInvoice, createPurchaseReturn, paySupplier, purchaseRegister, reverseSupplierPayment, setSupplierOpeningBalance,
  supplierAgeing, supplierBalances, supplierStatement, uninvoicedGrns, type PurchaseInvoiceInput,
} from './purchasing';
import { createRefund } from './refunds';
import { finalizeSale } from './sales';
import { openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { vatSummary } from './vat-report';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let milk: number;
let bread: number;
let sup: number; // VAT-registered, 30 days terms
let sup2: number; // no VAT number
let k = 0;
const key = () => `pur-key-${++k}-xxxx`;
const TODAY = '2026-11-05';
const DAY = 86_400_000;
const VATNO = '300000000000003';

const err = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};
const acct = (code: string) => {
  const r = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31').rows.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const stock = (id: number) => (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number }).qty;
const grn = (s = sup, qty = 100_000, cost = 400, productId = milk) => receiveGoods(ctx, u.admin, { supplierId: s, lines: [{ productId, qty, unitCost: cost }] }).grnId;
const inv = (o: Partial<PurchaseInvoiceInput>) =>
  createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: `S-${k}`, supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true, ...o });
const books = () => {
  expect(unbalancedEntries(ctx)).toEqual([]);
  expect(stockDrift(ctx)).toEqual([]);
  const tb = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31');
  expect(tb.totalDebit).toBe(tb.totalCredit);
  // Supplier balances add up to Accounts payable; un-invoiced receipts add up to account 2100.
  expect(supplierBalances(ctx, u.admin).reduce((s, r) => s + r.balance, 0)).toBe(0 - acct('2000'));
  expect(uninvoicedGrns(ctx, u.admin).reduce((s, g) => s + g.totalCost, 0)).toBe(0 - acct('2100'));
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  milk = createProduct(ctx, u.admin, { sku: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 650 });
  bread = createProduct(ctx, u.admin, { sku: 'BREAD', nameEn: 'Bread', nameAr: 'خبز', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 0, priceIncl: 100 }); // 0% for test only
  sup = createSupplier(ctx, u.admin, { name: 'Dairy Co', vatNumber: VATNO, paymentTermsDays: 30 });
  sup2 = createSupplier(ctx, u.admin, { name: 'Market Stall' });
});
afterEach(() => t.cleanup());

describe('supplier invoices', () => {
  it('matches a goods receipt: clears 2100, input VAT to 2210, payable to the supplier; due date from terms', () => {
    const g = grn();
    const r = inv({ grnIds: [g] });
    expect(r.pinvNo).toBe('PI-000001');
    expect(acct('2100')).toBe(0);
    expect(acct('2210')).toBe(6_000);
    expect(acct('2000')).toBe(-46_000);
    expect(supplierStatement(ctx, u.admin, sup).balance).toBe(46_000);
    expect((purchaseRegister(ctx, u.admin, TODAY, TODAY).invoices[0] as { dueDate: string }).dueDate).toBe('2026-12-05');
    books();
  });

  it('a price difference needs a reason and goes to 5010; the same receipt or supplier invoice cannot be entered twice', () => {
    const g = grn();
    expect(err(() => inv({ grnIds: [g], invoiceNet: 40_500 }))).toBe('VALIDATION');
    inv({ grnIds: [g], invoiceNet: 40_500, vatAmount: 6_075, differenceReason: 'Price increase' });
    expect(acct('5010')).toBe(500);
    expect(err(() => inv({ grnIds: [g] }))).toBe('CONFLICT');
    const g2 = grn();
    createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: 'DUP-1', supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [g2], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true });
    expect(err(() => createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: 'DUP-1', supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [grn()], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true }))).toBe('CONFLICT');
    books();
  });

  it("refuses another supplier's receipt, future dates and recoverable VAT without a VAT number; double-click records once", () => {
    const other = grn(sup2);
    expect(err(() => inv({ grnIds: [other] }))).toBe('VALIDATION');
    expect(err(() => inv({ grnIds: [grn()], invoiceDate: '2026-12-01' }))).toBe('VALIDATION');
    expect(err(() => createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup2, supplierInvoiceNo: 'X1', invoiceDate: TODAY, grnIds: [other], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true }))).toBe('VALIDATION');
    const rk = key();
    const g = grn();
    const a = createPurchaseInvoice(ctx, u.admin, { requestKey: rk, supplierId: sup, supplierInvoiceNo: 'ONCE', supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [g], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true });
    const b = createPurchaseInvoice(ctx, u.admin, { requestKey: rk, supplierId: sup, supplierInvoiceNo: 'ONCE', supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [g], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true });
    expect(b).toEqual({ ...a, replayed: true });
  });

  it('profit and loss includes purchase differences and unclaimed VAT (5010)', () => {
    createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup2, supplierInvoiceNo: 'PL-1', invoiceDate: TODAY, grnIds: [grn(sup2)], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: false });
    const pl = profitAndLoss(ctx, u.admin, TODAY, TODAY);
    expect(pl.operating.find((a) => a.code === '5010')?.amount).toBe(6_000);
    expect(pl.netProfit).toBe(balanceSheet(ctx, u.admin, TODAY).currentEarnings);
  });

  it('non-recoverable VAT is a cost (5010), not input VAT', () => {
    createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup2, supplierInvoiceNo: 'NR-1', invoiceDate: TODAY, grnIds: [grn(sup2)], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: false });
    expect(acct('2210')).toBe(0);
    expect(acct('5010')).toBe(6_000);
    books();
  });

  it('goods received together with the invoice: stock in and matched in one step', () => {
    inv({ newLines: [{ productId: milk, qty: 24_000, unitCost: 400 }], invoiceNet: 9_600, vatAmount: 1_440 });
    expect(stock(milk)).toBe(24_000);
    expect(uninvoicedGrns(ctx, u.admin)).toEqual([]);
    books();
  });
});

describe('returns, opening balances, payments, ageing', () => {
  it('return to supplier: stock out at average cost, payable reduced, VAT reversed; cannot return more than on hand', () => {
    inv({ grnIds: [grn()] });
    expect(err(() => createPurchaseReturn(ctx, u.admin, { requestKey: key(), supplierId: sup, returnDate: TODAY, reason: 'Expired', lines: [{ productId: milk, qty: 200_000 }], creditNet: 4_000, vatAmount: 600, vatRecoverable: true }))).toBe('VALIDATION');
    const r = createPurchaseReturn(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierCreditRef: 'CN-9', returnDate: TODAY, reason: 'Expired', lines: [{ productId: milk, qty: 10_000 }], creditNet: 4_000, vatAmount: 600, vatRecoverable: true });
    expect(r).toMatchObject({ pretNo: 'PR-000001', stockValue: 4_000 });
    expect(stock(milk)).toBe(90_000);
    expect(acct('2210')).toBe(6_000 - 600);
    expect(supplierStatement(ctx, u.admin, sup).balance).toBe(46_000 - 4_600);
    books();
  });

  it('opening balance once per supplier (against opening equity); payments partial, never more than owed, idempotent, reversible', () => {
    setSupplierOpeningBalance(ctx, u.admin, { supplierId: sup, amount: 100_000, asOf: TODAY, reference: 'Old system statement' });
    expect(err(() => setSupplierOpeningBalance(ctx, u.admin, { supplierId: sup, amount: 1, asOf: TODAY }))).toBe('CONFLICT');
    expect(acct('3000')).toBe(100_000);
    expect(err(() => paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 100_001, method: 'bank', paidOn: TODAY }))).toBe('VALIDATION');
    const rk = key();
    const p = paySupplier(ctx, u.admin, { requestKey: rk, supplierId: sup, amount: 30_000, method: 'bank', paidOn: TODAY, reference: 'TRX-55' });
    expect(paySupplier(ctx, u.admin, { requestKey: rk, supplierId: sup, amount: 30_000, method: 'bank', paidOn: TODAY, reference: 'TRX-55' }).replayed).toBe(true);
    expect(supplierStatement(ctx, u.admin, sup).balance).toBe(70_000);
    reverseSupplierPayment(ctx, u.admin, p.paymentId, key(), 'Transfer failed');
    expect(err(() => reverseSupplierPayment(ctx, u.admin, p.paymentId, key(), 'again'))).toBe('CONFLICT');
    expect(supplierStatement(ctx, u.admin, sup).balance).toBe(100_000);
    expect(acct('1030')).toBe(0);
    books();
  });

  it('paying from the till needs an open shift and lowers the expected drawer cash', () => {
    inv({ grnIds: [grn()] });
    expect(err(() => paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 5_000, method: 'till', paidOn: TODAY }))).toBe('NO_OPEN_SHIFT');
    const sh = openShift(ctx, u.cashier, 50_000);
    paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 5_000, method: 'till', paidOn: TODAY });
    expect(shiftSummary(ctx, sh)).toMatchObject({ tillSupplierPayments: 5_000, expectedCash: 45_000 });
    books();
  });

  it('ageing: payments settle the oldest invoices first; the rest is grouped by days past due', () => {
    inv({ grnIds: [grn()] }); // 460.00 due 2026-12-05
    t.advance(20 * DAY);
    inv({ grnIds: [grn()], invoiceDate: '2026-11-25' }); // 460.00 due 2026-12-25
    paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 10_000, method: 'bank', paidOn: '2026-11-25' });
    t.advance(25 * DAY); // 2026-12-20
    const [a] = supplierAgeing(ctx, u.admin, '2026-12-20');
    expect(a).toMatchObject({ supplier: 'Dairy Co', d1_30: 36_000, notDue: 46_000, balance: 82_000 });
    expect(supplierAgeing(ctx, u.admin, '2027-03-10')[0]).toMatchObject({ over90: 36_000, d61_90: 46_000 });
  });
});

describe('VAT summary (provisional, for the accountant)', () => {
  it('output and input VAT from sales, refunds, purchases, returns and expenses agree with the VAT accounts', () => {
    inv({ grnIds: [grn()] });
    receiveGoods(ctx, u.admin, { supplierId: sup2, lines: [{ productId: bread, qty: 50_000, unitCost: 50 }] });
    openShift(ctx, u.cashier, 0);
    const s = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: milk, qty: 10_000 }, { productId: bread, qty: 5_000 }], payments: [{ tender: 'cash', amount: 10_000 }] });
    createRefund(ctx, u.cashier, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'r', lines: [{ saleLineNo: 1, qty: 2_000, restock: true }], approverId: u.supervisor });
    createPurchaseReturn(ctx, u.admin, { requestKey: key(), supplierId: sup, returnDate: TODAY, reason: 'Damaged', lines: [{ productId: milk, qty: 5_000 }], creditNet: 2_000, vatAmount: 300, vatRecoverable: true });
    const cat = listCategories(ctx, u.admin).find((c) => c.nameEn === 'Cleaning')!.id;
    const e1 = createExpense(ctx, u.admin, { requestKey: key(), categoryId: cat, description: 'Cleaning', expenseDate: TODAY, gross: 11_500, vatClass: 'standard', vatAmount: 1_500, vatRecoverable: true, invoiceRef: 'C-1', supplierVatNo: VATNO });
    postExpense(ctx, u.admin, e1);
    const e2 = createExpense(ctx, u.admin, { requestKey: key(), categoryId: cat, description: 'Cleaning 2', expenseDate: TODAY, gross: 2_300, vatClass: 'standard', vatAmount: 300, vatRecoverable: true, invoiceRef: 'C-2', supplierVatNo: VATNO });
    postExpense(ctx, u.admin, e2);
    reverseExpense(ctx, u.admin, e2, 'duplicate');

    const v = vatSummary(ctx, u.admin, TODAY, TODAY);
    expect(v.salesStandard).toEqual({ net: 5_652, vat: 848 }); // 10 x 6.50 = 65.00 incl.
    expect(v.salesZeroOrExempt.net).toBe(500);
    expect(v.refundsStandard.vat).toBe(170); // 2 of 10 milk: 13.00 incl.
    expect(v.purchasesRecoverable).toEqual({ net: 40_000, vat: 6_000 });
    expect(v.purchaseReturnsRecoverable).toEqual({ net: 2_000, vat: 300 });
    expect(v.expensesRecoverable.vat).toBe(1_800);
    expect(v.expensesReversedRecoverable.vat).toBe(300);
    expect(v.outputVat).toBe(848 - 170);
    expect(v.inputVat).toBe(6_000 - 300 + 1_800 - 300);
    expect(v.netVatDue).toBe(v.outputVat - v.inputVat);
    expect(v.reconciles).toBe(true);
    books();
  });
});

describe('permissions', () => {
  it('cashier sees nothing; supervisor can view but not enter invoices or pay; owner can', () => {
    const g = grn();
    expect(err(() => uninvoicedGrns(ctx, u.cashier))).toBe('PERMISSION_DENIED');
    expect(uninvoicedGrns(ctx, u.supervisor)).toHaveLength(1);
    expect(err(() => createPurchaseInvoice(ctx, u.supervisor, { requestKey: key(), supplierId: sup, supplierInvoiceNo: 'P', supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [g], invoiceNet: 40_000, vatAmount: 6_000, vatRecoverable: true }))).toBe('PERMISSION_DENIED');
    expect(err(() => paySupplier(ctx, u.supervisor, { requestKey: key(), supplierId: sup, amount: 1, method: 'bank', paidOn: TODAY }))).toBe('PERMISSION_DENIED');
    expect(err(() => vatSummary(ctx, u.supervisor, TODAY, TODAY))).toBe('PERMISSION_DENIED');
  });

  it('purchase documents are immutable', () => {
    inv({ grnIds: [grn()] });
    expect(() => ctx.db.prepare('UPDATE purchase_invoices SET gross = 1').run()).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM purchase_invoice_grns').run()).toThrow(/immutable/);
  });
});
