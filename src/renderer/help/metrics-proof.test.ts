import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storeDay } from '../../core/store-time';
import { createProduct } from '../../services/catalog';
import type { Ctx } from '../../services/context';
import { customerAccount, recordCustomerReceipt, updateCustomerCredit } from '../../services/credit';
import { balanceSheet, cashFlow, ownerKpis, profitAndLoss } from '../../services/financials';
import { receiveGoods } from '../../services/inventory';
import { postEntry } from '../../services/ledger';
import { createCustomer, createSupplier } from '../../services/parties';
import { createPurchaseInvoice, paySupplier, supplierControls, uninvoicedGrns } from '../../services/purchasing';
import { createRefund } from '../../services/refunds';
import { finalizeSale } from '../../services/sales';
import { closeShift, openShift, recordCashMovement, shiftSummary } from '../../services/shifts';
import { makeTestCtx, seedUsers } from '../../services/test-helpers';
import { vatSummary } from '../../services/vat-report';

// Builds the worked examples from Help through the real services. If a formula changes, one of these fails.
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let sup: number;
let n = 0;
const SAR = 100;
const day = () => storeDay(ctx.now());
const product = (priceIncl: number, unitCost: number, stock = 1_000_000) => {
  const id = createProduct(ctx, u.admin, { sku: `P${++n}`, nameEn: `Item ${n}`, nameAr: `صنف ${n}`, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl });
  receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: id, qty: stock, unitCost }] });
  return id;
};
const sell = (productId: number, qty: number, payments: { tender: 'cash' | 'card' | 'account'; amount: number }[], customerId?: number) =>
  finalizeSale(ctx, u.supervisor, { idempotencyKey: `proof-sale-${++n}`, lines: [{ productId, qty }], payments, customerId });
const expense = (amount: number) => postEntry(ctx, { date: day(), sourceType: 'proof', sourceId: ++n, memo: 'expense', lines: [{ account: '6100', debit: amount }, { account: '3000', credit: amount }] });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  sup = createSupplier(ctx, u.admin, { name: 'Farm', vatNumber: '300000000000103' });
});
afterEach(() => t.cleanup());

describe('Help examples are true', () => {
  it('gross profit: sales 20,000 less cost of goods 12,000 is 8,000', () => {
    openShift(ctx, u.supervisor, 0);
    const item = product(2_300_000, 1_200_000, 10_000); // SAR 23,000 with VAT is SAR 20,000 without
    sell(item, 1000, [{ tender: 'cash', amount: 2_300_000 }]);
    const p = profitAndLoss(ctx, u.admin, day(), day());
    expect(p).toMatchObject({ netSales: 20_000 * SAR, cogs: 12_000 * SAR, grossProfit: 8_000 * SAR });
  });

  it('net profit: gross profit 8,000 less expenses 3,000 is 5,000', () => {
    openShift(ctx, u.supervisor, 0);
    const item = product(2_300_000, 1_200_000, 10_000);
    sell(item, 1000, [{ tender: 'cash', amount: 2_300_000 }]);
    expense(3_000 * SAR);
    expect(profitAndLoss(ctx, u.admin, day(), day())).toMatchObject({ totalOperating: 3_000 * SAR, netProfit: 5_000 * SAR });
  });

  it('expected cash: float 200 + sales 450 − out 100 − refunds 50 = 500', () => {
    const shift = openShift(ctx, u.supervisor, 200 * SAR);
    const item = product(450 * SAR, 100);
    sell(item, 1000, [{ tender: 'cash', amount: 500 * SAR }]); // SAR 50 of change
    recordCashMovement(ctx, u.supervisor, 'out', 100 * SAR, 'To the bank');
    const small = product(50 * SAR, 100);
    const sale = sell(small, 1000, [{ tender: 'card', amount: 50 * SAR }]);
    createRefund(ctx, u.supervisor, { requestKey: 'proof-refund-1', invoiceNo: sale.invoiceNo, reason: 'Wrong item', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] });
    expect(shiftSummary(ctx, shift)).toMatchObject({ cashSales: 450 * SAR, cashOut: 100 * SAR, cashRefunds: 50 * SAR, expectedCash: 500 * SAR });
  });

  it('cash difference: expected 1,250, counted 1,240 is 10 short', () => {
    openShift(ctx, u.supervisor, 1_250 * SAR);
    const r = closeShift(ctx, u.supervisor, 1_240 * SAR);
    expect((r.countedCash ?? 0) - r.expectedCash).toBe(-10 * SAR);
  });

  it('balance sheet: both sides agree', () => {
    openShift(ctx, u.supervisor, 0);
    const item = product(115 * SAR, 50 * SAR, 10_000);
    sell(item, 1000, [{ tender: 'cash', amount: 115 * SAR }]);
    const b = balanceSheet(ctx, u.admin, day());
    expect(b.balanced).toBe(true);
    expect(b.totalAssets).toBe(b.totalLiabilitiesAndEquity);
  });

  it('customer credit: bought 200, paid 100, 100 is owed', () => {
    openShift(ctx, u.supervisor, 0);
    const c = createCustomer(ctx, u.admin, { name: 'Amal', phone: '0500000001' });
    updateCustomerCredit(ctx, u.admin, { customerId: c, creditEnabled: true, creditLimit: 1000 * SAR, paymentTermsDays: 30 });
    const item = product(200 * SAR, 100);
    sell(item, 1000, [{ tender: 'account', amount: 200 * SAR }], c);
    const saleId = (ctx.db.prepare('SELECT sale_id AS id FROM receivables').get() as { id: number }).id;
    recordCustomerReceipt(ctx, u.supervisor, { requestKey: 'proof-receipt-1', customerId: c, amount: 100 * SAR, method: 'cash', allocations: [{ saleId, amount: 100 * SAR }] });
    expect(customerAccount(ctx, u.admin, c).outstanding).toBe(100 * SAR);
  });

  it('supplier payable: bought 1,000, paid 400, 600 is owed', () => {
    const item = createProduct(ctx, u.admin, { sku: 'S1', nameEn: 'Sup', nameAr: 'مورد', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 2000 });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: item, qty: 10_000, unitCost: 100 * SAR }] });
    const grn = uninvoicedGrns(ctx, u.admin).find((g) => g.supplierId === sup)!;
    createPurchaseInvoice(ctx, u.admin, { requestKey: 'proof-invoice-1', supplierId: sup, supplierInvoiceNo: 'INV-1', supplierVatNo: '300000000000103', invoiceDate: day(), grnIds: [grn.grnId], invoiceNet: 1_000 * SAR, vatAmount: 0, vatRecoverable: false });
    paySupplier(ctx, u.admin, { requestKey: 'proof-payment-1', supplierId: sup, amount: 400 * SAR, method: 'bank', paidOn: day() });
    expect(supplierControls(ctx).payablesOpen).toBe(600 * SAR);
  });

  it('cash flow: start + net change = end, and matches cash and bank', () => {
    openShift(ctx, u.supervisor, 0);
    const item = product(900 * SAR, 100);
    sell(item, 1000, [{ tender: 'cash', amount: 900 * SAR }]);
    recordCashMovement(ctx, u.supervisor, 'out', 700 * SAR, 'Paid out');
    const f = cashFlow(ctx, u.admin, day(), day());
    expect(f.net).toBe(200 * SAR);
    expect(f.opening + f.net).toBe(f.closing);
    expect(f.closing).toBe(ownerKpis(ctx, u.admin, day(), day()).cashAndBank);
  });

  it('VAT: a 115 sale holds 15 of output VAT, and net VAT is output less input', () => {
    openShift(ctx, u.supervisor, 0);
    const item = product(115 * SAR, 100);
    sell(item, 1000, [{ tender: 'cash', amount: 115 * SAR }]);
    const v = vatSummary(ctx, u.admin, day(), day());
    expect(v.outputVat).toBe(15 * SAR);
    expect(v.netVatDue).toBe(v.outputVat - v.inputVat);
  });

  it('average cost: 5 at SAR 4 and 5 at SAR 6 average SAR 5', () => {
    const id = createProduct(ctx, u.admin, { sku: 'AV', nameEn: 'Avg', nameAr: 'متوسط', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: id, qty: 5000, unitCost: 400 }] });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: id, qty: 5000, unitCost: 600 }] });
    expect(ctx.db.prepare('SELECT avg_cost AS c FROM stock_balances WHERE product_id = ?').get(id)).toEqual({ c: 500 });
  });
});
