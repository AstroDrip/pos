import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { listCustomerAccounts, updateCustomerCredit } from './credit';
import { receiveGoods } from './inventory';
import { createCustomer, createSupplier } from './parties';
import { createPurchaseReturn, listPurchaseReturns, setSupplierOpeningBalance } from './purchasing';
import { createRefund, recentSales } from './refunds';
import { finalizeSale } from './sales';
import { closeShift, listShifts, openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { createUser } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number;
const DAY = 86_400_000;
let n = 0;
const sell = (amount = 1000) => finalizeSale(ctx, u.cashier, { idempotencyKey: `empty-list-${++n}`, lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount }] });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Farm' }), lines: [{ productId: item, qty: 100_000, unitCost: 500 }] });
});
afterEach(() => t.cleanup());

describe('customers with no search', () => {
  beforeEach(() => {
    const b = createCustomer(ctx, u.admin, { name: 'banu', phone: '0500000002' });
    createCustomer(ctx, u.admin, { name: 'Amal', phone: '0500000001' });
    createCustomer(ctx, u.admin, { name: 'Cyrus', phone: '0500000003' });
    updateCustomerCredit(ctx, u.admin, { customerId: b, creditEnabled: true, creditLimit: 50_000, paymentTermsDays: 30 });
  });
  const list = (offset = 0, limit = 100) => listCustomerAccounts(ctx, u.cashier, { offset, limit });

  it('lists everyone A to Z and gives the full count', () => {
    expect(list().items.map((c) => c.name)).toEqual(['Amal', 'banu', 'Cyrus']);
    expect(list().total).toBe(3);
  });

  it('pages through the list', () => {
    expect(list(0, 2).items.map((c) => c.name)).toEqual(['Amal', 'banu']);
    expect(list(2, 2).items.map((c) => c.name)).toEqual(['Cyrus']);
    expect(list(2, 2).total).toBe(3);
  });

  it('shows the same credit figures a search shows', () => {
    expect(list().items[1]).toMatchObject({ creditEnabled: true, limit: 50_000, outstanding: 0, advance: 0, available: 50_000 });
  });

  it('needs permission', () => {
    const nobody = createUser(ctx, u.admin, { username: 'none', displayName: 'None', pin: '3333', roles: [] });
    expect(() => listCustomerAccounts(ctx, nobody, { offset: 0, limit: 10 })).toThrow();
  });
});

describe('recent sales for refund', () => {
  beforeEach(() => void openShift(ctx, u.cashier, 0));

  it('lists sales newest first with the full count', () => {
    const a = sell();
    t.advance(60_000);
    const b = sell();
    const r = recentSales(ctx, u.cashier, { offset: 0, limit: 10 });
    expect(r.items.map((s) => s.invoiceNo)).toEqual([b.invoiceNo, a.invoiceNo]);
    expect(r.total).toBe(2);
    expect(r.items[0]).toMatchObject({ cashier: 'Cashier', totalIncl: 1000, customer: null, refunded: false, withinWindow: true });
  });

  it('pages through the list', () => {
    const a = sell();
    t.advance(60_000);
    sell();
    expect(recentSales(ctx, u.cashier, { offset: 1, limit: 1 }).items.map((s) => s.invoiceNo)).toEqual([a.invoiceNo]);
  });

  it('marks a sale that has been refunded', () => {
    const a = sell();
    createRefund(ctx, u.supervisor, { requestKey: 'empty-list-refund', invoiceNo: a.invoiceNo, reason: 'Wrong item', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] });
    expect(recentSales(ctx, u.cashier, { offset: 0, limit: 10 }).items[0]!.refunded).toBe(true);
  });

  it('marks an old sale as past the refund limit, but still lists it', () => {
    sell();
    t.advance(8 * DAY);
    expect(recentSales(ctx, u.cashier, { offset: 0, limit: 10 }).items[0]).toMatchObject({ withinWindow: false, daysSinceSale: 8 });
  });

  it('needs permission', () => {
    const nobody = createUser(ctx, u.admin, { username: 'none', displayName: 'None', pin: '3333', roles: [] });
    expect(() => recentSales(ctx, nobody, { offset: 0, limit: 10 })).toThrow();
  });
});

describe('past supplier returns', () => {
  it('lists returns newest first, with the supplier and amounts', () => {
    const supplier = createSupplier(ctx, u.admin, { name: 'Valley', vatNumber: '300000000000103' });
    setSupplierOpeningBalance(ctx, u.admin, { supplierId: supplier, amount: 100_000, asOf: '2026-11-05' });
    receiveGoods(ctx, u.admin, { supplierId: supplier, lines: [{ productId: item, qty: 5000, unitCost: 500 }] });
    const ret = (ref: string) => createPurchaseReturn(ctx, u.admin, { requestKey: `empty-list-${ref}`, supplierId: supplier, supplierCreditRef: ref, returnDate: '2026-11-05', reason: 'Damaged', lines: [{ productId: item, qty: 1000 }], creditNet: 500, vatAmount: 75, vatRecoverable: true });
    const a = ret('CN-1');
    const b = ret('CN-2');
    const rows = listPurchaseReturns(ctx, u.admin, 10);
    expect(rows.map((r) => r.pretNo)).toEqual([b.pretNo, a.pretNo]);
    expect(rows[0]).toMatchObject({ supplier: 'Valley', supplierCreditRef: 'CN-2', returnDate: '2026-11-05', reason: 'Damaged', gross: 575 });
  });

  it('needs permission', () => {
    expect(() => listPurchaseReturns(ctx, u.cashier, 10)).toThrow(/purchase\.view/);
  });
});

describe('past shifts', () => {
  it('lists shifts newest first, with who ran them and the cash difference', () => {
    const first = openShift(ctx, u.cashier, 10_000);
    sell();
    const expected = shiftSummary(ctx, first).expectedCash;
    t.advance(3_600_000);
    closeShift(ctx, u.cashier, expected - 250);
    t.advance(3_600_000);
    const second = openShift(ctx, u.supervisor, 5000);
    const rows = listShifts(ctx, u.admin, 10);
    expect(rows.map((r) => r.shiftId)).toEqual([second, first]);
    expect(rows[0]).toMatchObject({ status: 'open', openedBy: 'Supervisor', closedAt: null, saleCount: 0, expectedCash: null, countedCash: null, difference: null });
    expect(rows[1]).toMatchObject({ status: 'closed', openedBy: 'Cashier', saleCount: 1, salesTotal: 1000, expectedCash: expected, countedCash: expected - 250, difference: -250 });
  });

  it('is only for people who can see reports', () => {
    expect(() => listShifts(ctx, u.cashier, 10)).toThrow();
  });
});
