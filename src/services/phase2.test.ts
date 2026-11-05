// Phase 2: refunds (credit notes) under the owner's policy D1, wastage and stock counts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postStockCount, recordWastage } from './adjustments';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { receiveGoods, stockDrift } from './inventory';
import { trialBalance, unbalancedEntries } from './ledger';
import { createSupplier } from './parties';
import { adjustmentsReport, cashierActivity, refundsReport, salesSummary } from './reports';
import { createRefund, findSaleForRefund, refundReceiptData } from './refunds';
import { finalizeSale, receiptData } from './sales';
import { closeShift, openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let milk: number; // 6.50 SAR, unit
let lamb: number; // 49.99 SAR/kg, weighed
let k = 0;
const key = () => `p2-key-${++k}-xxxx`;
const DAY = 86_400_000;

const stock = (id: number) => (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number }).qty;
const account = (code: string) => trialBalance(ctx).find((r) => r.code === code) ?? { debit: 0, credit: 0 };
const errCode = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW: ${(e as Error).message}`;
  }
};
function cashSale(lines: { productId: number; qty: number; discount?: number }[]) {
  return finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines, payments: [{ tender: 'cash', amount: 1_000_000 }], discountApproverId: u.supervisor });
}
function cardSale(lines: { productId: number; qty: number }[], total: number) {
  return finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines, payments: [{ tender: 'card', amount: total }] });
}
const refund = (invoiceNo: string, lines: { saleLineNo: number; qty: number; restock?: boolean }[], opts: { user?: number; approverId?: number; requestKey?: string } = {}) =>
  createRefund(ctx, opts.user ?? u.cashier, {
    requestKey: opts.requestKey ?? key(),
    invoiceNo,
    reason: 'Customer returned',
    lines: lines.map((l) => ({ restock: true, ...l })),
    approverId: 'approverId' in opts ? opts.approverId : u.supervisor,
  });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  milk = createProduct(ctx, u.admin, { sku: 'MILK', nameEn: 'Fresh Milk 1L', nameAr: 'حليب طازج', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 650, barcodes: ['6281000000137'] });
  lamb = createProduct(ctx, u.admin, { sku: 'LAMB', nameEn: 'Lamb Leg', nameAr: 'فخذ غنم', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 4999, plu: '200' });
  const sup = createSupplier(ctx, u.admin, { name: 'Supplier' });
  receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: milk, qty: 100_000, unitCost: 400 }, { productId: lamb, qty: 50_000, unitCost: 3000 }] });
  openShift(ctx, u.cashier, 50_000);
});
afterEach(() => t.cleanup());

describe('refunds (credit notes)', () => {
  it('full refund of a cash sale: credit note, stock back, cash out of the drawer, books balance, sale untouched', () => {
    const s = cashSale([{ productId: milk, qty: 2000 }]);
    const before = shiftSummary(ctx, 1).expectedCash;
    const r = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 2000 }]);
    expect(r.refundNo).toBe('CN-00000001');
    expect(r.totalIncl).toBe(1300);
    expect(stock(milk)).toBe(100_000);
    const sh = shiftSummary(ctx, 1);
    expect(sh.cashRefunds).toBe(1300);
    expect(sh.refundCount).toBe(1);
    expect(sh.expectedCash).toBe(before - 1300);
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(stockDrift(ctx)).toEqual([]);
    // Revenue and VAT reversed exactly: net zero on 4000 and 2200 for this sale; COGS reversed at the sale cost.
    expect(account('4000').debit).toBe(account('4000').credit);
    expect(account('2200').debit).toBe(account('2200').credit);
    expect(account('5000').debit).toBe(account('5000').credit);
    expect(receiptData(ctx, s.saleId).totalIncl).toBe(1300); // the original sale is unchanged
  });

  it('a card sale is refunded in cash (owner policy) and the screen shows it was paid by card', () => {
    const s = cardSale([{ productId: milk, qty: 1000 }], 650);
    const found = findSaleForRefund(ctx, u.cashier, s.invoiceNo.toLowerCase());
    expect(found.paidByCard).toBe(650);
    refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    expect(shiftSummary(ctx, 1).expectedCash).toBe(50_000 - 650);
    expect(account('1020').debit).toBe(650); // card clearing untouched: the bank still pays the store for the sale
  });

  it('partial refunds share the discount and never add up to more than was paid', () => {
    // 3 x 6.50 = 19.50, discount 1.00 -> paid 18.50 for the line
    const s = cashSale([{ productId: milk, qty: 3000, discount: 100 }]);
    const a = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    const b = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    const c = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    expect(a.totalIncl).toBe(617); // 1850/3 = 616.67 rounded
    expect(b.totalIncl).toBe(617);
    expect(c.totalIncl).toBe(616); // exact remainder
    expect(a.totalIncl + b.totalIncl + c.totalIncl).toBe(1850);
    const vat = ctx.db.prepare('SELECT SUM(total_vat) AS v FROM refunds').get() as { v: number };
    const saleVat = ctx.db.prepare('SELECT total_vat AS v FROM sales').get() as { v: number };
    expect(vat.v).toBe(saleVat.v);
    expect(unbalancedEntries(ctx)).toEqual([]);
  });

  it('cannot refund more than was sold, or the same items twice', () => {
    const s = cashSale([{ productId: milk, qty: 2000 }]);
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 3000 }]))).toBe('VALIDATION');
    refund(s.invoiceNo, [{ saleLineNo: 1, qty: 2000 }]);
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]))).toBe('VALIDATION');
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 2, qty: 1000 }]))).toBe('NOT_FOUND');
    expect(findSaleForRefund(ctx, u.cashier, s.invoiceNo).lines[0]!.remainingQty).toBe(0);
  });

  it('every refund needs a supervisor: a cashier alone, or with another cashier, is refused', () => {
    const s = cashSale([{ productId: milk, qty: 1000 }]);
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }], { approverId: undefined }))).toBe('PERMISSION_DENIED');
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }], { approverId: u.cashier }))).toBe('PERMISSION_DENIED');
    const r = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    const row = ctx.db.prepare('SELECT user_id, approved_by FROM refunds WHERE id = ?').get(r.refundId) as { user_id: number; approved_by: number };
    expect(row).toEqual({ user_id: u.cashier, approved_by: u.supervisor });
    // A logged-in supervisor approves their own refund.
    const s2 = cashSale([{ productId: milk, qty: 1000 }]);
    const r2 = refund(s2.invoiceNo, [{ saleLineNo: 1, qty: 1000 }], { user: u.supervisor, approverId: undefined });
    expect((ctx.db.prepare('SELECT approved_by FROM refunds WHERE id = ?').get(r2.refundId) as { approved_by: number }).approved_by).toBe(u.supervisor);
  });

  it('7-day window in Saudi store days: day 7 allowed, day 8 refused', () => {
    const s = cashSale([{ productId: milk, qty: 2000 }]); // 2026-11-05 11:00 Riyadh
    t.advance(7 * DAY);
    expect(findSaleForRefund(ctx, u.cashier, s.invoiceNo).withinWindow).toBe(true);
    refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    t.advance(DAY);
    const f = findSaleForRefund(ctx, u.cashier, s.invoiceNo);
    expect(f.daysSinceSale).toBe(8);
    expect(f.withinWindow).toBe(false);
    expect(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }])).toThrow(/8 days old.*within 7 days/);
  });

  it('receipt required: unknown invoice is refused; no open shift is refused', () => {
    expect(errCode(() => refund('INV-99999999', [{ saleLineNo: 1, qty: 1000 }]))).toBe('NOT_FOUND');
    const s = cashSale([{ productId: milk, qty: 1000 }]);
    closeShift(ctx, u.cashier, 50_650);
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]))).toBe('NO_OPEN_SHIFT');
  });

  it('a double-clicked refund pays out once', () => {
    const s = cashSale([{ productId: milk, qty: 1000 }]);
    const rk = key();
    const a = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }], { requestKey: rk });
    const b = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }], { requestKey: rk });
    expect(b.replayed).toBe(true);
    expect(b.refundId).toBe(a.refundId);
    expect(shiftSummary(ctx, 1).refundCount).toBe(1);
  });

  it('damaged goods are refunded but not put back on the shelf', () => {
    const s = cashSale([{ productId: milk, qty: 2000 }]);
    refund(s.invoiceNo, [{ saleLineNo: 1, qty: 2000, restock: false }]);
    expect(stock(milk)).toBe(98_000);
    expect(account('5000').debit - account('5000').credit).toBe(800); // the cost stays an expense
    expect(unbalancedEntries(ctx)).toEqual([]);
  });

  it('weighed items can be part-refunded by weight; unit items only in whole units', () => {
    const s = cashSale([{ productId: lamb, qty: 1200 }, { productId: milk, qty: 2000 }]);
    const r = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 500 }]);
    expect(r.totalIncl).toBe(2500); // 1.2 kg x 49.99 = 59.99; 0.5/1.2 of it = 24.996 -> 25.00
    expect(errCode(() => refund(s.invoiceNo, [{ saleLineNo: 2, qty: 500 }]))).toBe('VALIDATION');
  });

  it('refunds are immutable and print as a credit note linked to the original invoice', () => {
    const s = cashSale([{ productId: milk, qty: 1000 }]);
    const r = refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    expect(() => ctx.db.prepare('UPDATE refunds SET total_incl = 1 WHERE id = ?').run(r.refundId)).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM refund_lines').run()).toThrow(/immutable/);
    const rc = refundReceiptData(ctx, r.refundId);
    expect(rc).toMatchObject({ kind: 'refund', invoiceNo: 'CN-00000001', originalInvoiceNo: s.invoiceNo, approver: 'Supervisor', totalIncl: 650, payments: [{ tender: 'cash', amount: 650 }] });
    const audit = ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'sale.refund'").get() as { details_json: string };
    expect(JSON.parse(audit.details_json)).toMatchObject({ refundNo: 'CN-00000001', invoiceNo: s.invoiceNo, approver: u.supervisor });
  });

  it('reports: sales summary shows refunds and net, cashier report shows who refunded and who approved', () => {
    const s = cashSale([{ productId: milk, qty: 2000 }]);
    refund(s.invoiceNo, [{ saleLineNo: 1, qty: 1000 }]);
    const sum = salesSummary(ctx, u.admin, '2026-11-05', '2026-11-05');
    expect(sum).toMatchObject({ totalIncl: 1300, refundCount: 1, refundTotal: 650, netIncl: 650 });
    const act = cashierActivity(ctx, u.admin, '2026-11-05', '2026-11-05');
    expect(act.find((a) => a.userId === u.cashier)).toMatchObject({ refundCount: 1, refundTotal: 650 });
    expect(act.find((a) => a.userId === u.supervisor)).toMatchObject({ refundsApproved: 1 });
    expect(refundsReport(ctx, u.admin, '2026-11-05', '2026-11-05')).toEqual([
      expect.objectContaining({ refundNo: 'CN-00000001', invoiceNo: s.invoiceNo, cashier: 'Cashier', approver: 'Supervisor', items: 1, restockedItems: 1, total: 650 }),
    ]);
    expect(errCode(() => refundsReport(ctx, u.cashier, '2026-11-05', '2026-11-05'))).toBe('PERMISSION_DENIED');
  });
});

describe('wastage and stock counts', () => {
  it('wastage takes stock off at average cost and posts to Wastage; cashier refused; double-click records once', () => {
    expect(errCode(() => recordWastage(ctx, u.cashier, { requestKey: key(), reason: 'Expired', lines: [{ productId: milk, qty: 1000 }] }))).toBe('PERMISSION_DENIED');
    const rk = key();
    const w = recordWastage(ctx, u.supervisor, { requestKey: rk, reason: 'Expired', lines: [{ productId: milk, qty: 3000 }] });
    expect(w).toMatchObject({ adjNo: 'ADJ-000001', changedLines: 1, totalValue: -1200 });
    expect(recordWastage(ctx, u.supervisor, { requestKey: rk, reason: 'Expired', lines: [{ productId: milk, qty: 3000 }] }).replayed).toBe(true);
    expect(stock(milk)).toBe(97_000);
    expect(account('5100').debit).toBe(1200);
    expect(errCode(() => recordWastage(ctx, u.supervisor, { requestKey: key(), reason: 'x', lines: [{ productId: milk, qty: 500 }] }))).toBe('VALIDATION');
    expect(errCode(() => recordWastage(ctx, u.supervisor, { requestKey: key(), reason: ' ', lines: [{ productId: milk, qty: 1000 }] }))).toBe('VALIDATION');
  });

  it('a stock count sets stock to the counted amount and records only the differences (gains and losses)', () => {
    const c = postStockCount(ctx, u.supervisor, {
      requestKey: key(),
      reason: 'Monthly count',
      lines: [{ productId: milk, countedQty: 98_000 }, { productId: lamb, countedQty: 50_250 }],
    });
    expect(c.changedLines).toBe(2);
    expect(stock(milk)).toBe(98_000);
    expect(stock(lamb)).toBe(50_250);
    // milk -2 x 4.00 = -8.00 ; lamb +0.25 kg x 30.00 = +7.50
    expect(c.totalValue).toBe(-50);
    const rows = adjustmentsReport(ctx, u.admin, '2026-11-05', '2026-11-05');
    expect(rows.map((r) => [r.sku, r.systemQty, r.countedQty, r.qty, r.value])).toEqual([
      ['MILK', 100_000, 98_000, -2000, -800],
      ['LAMB', 50_000, 50_250, 250, 750],
    ]);
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(stockDrift(ctx)).toEqual([]);
    const none = postStockCount(ctx, u.supervisor, { requestKey: key(), reason: 'Recount', lines: [{ productId: milk, countedQty: 98_000 }] });
    expect(none).toMatchObject({ adjustmentId: null, changedLines: 0 });
  });

  it('adjustment records are immutable', () => {
    recordWastage(ctx, u.supervisor, { requestKey: key(), reason: 'Damaged', lines: [{ productId: milk, qty: 1000 }] });
    expect(() => ctx.db.prepare('UPDATE stock_adjustments SET reason = ?').run('x')).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM stock_adjustment_lines').run()).toThrow(/immutable/);
  });
});

describe('BUG-015: selling before stock arrives', () => {
  it('when goods arrive, the cost of units already sold below zero moves to COGS, so Inventory matches the shelf', () => {
    const water = createProduct(ctx, u.admin, { sku: 'WAT', nameEn: 'Water', nameAr: 'ماء', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 });
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: water, qty: 2000 }], payments: [{ tender: 'cash', amount: 500 }] }); // stock -2 at cost 0.00
    const inv0 = account('1200').debit - account('1200').credit;
    const cogs0 = account('5000').debit - account('5000').credit;
    const sup = createSupplier(ctx, u.admin, { name: 'Water Co' });
    receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: water, qty: 24_000, unitCost: 150 }] });
    expect(stock(water)).toBe(22_000);
    // +36.00 received, -3.00 for the 2 bottles already sold: the shelf holds 22 x 1.50 = 33.00 of water
    expect(account('1200').debit - account('1200').credit - inv0).toBe(3300);
    expect(account('5000').debit - account('5000').credit - cogs0).toBe(300);
    expect(unbalancedEntries(ctx)).toEqual([]);
  });
});
