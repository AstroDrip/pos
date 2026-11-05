// Customer credit (AR) and supplier credit (AP): the edge cases of the credit-management prompt (§18), checking money,
// ledgers, control accounts and status. Accounting is PROVISIONAL until the accountant approves.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '../db/migrations';
import { openDatabase } from '../db/connection';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import {
  applyCustomerAdvance, creditControls, customerAccount, customerStatement, receivablesAgeing, recordCustomerReceipt, reverseCustomerReceipt,
  setInvoiceDispute, suggestCustomerAllocation, updateCustomerCredit, writeOffInvoice,
} from './credit';
import { datedTrialBalance, ownerKpis, profitAndLoss } from './financials';
import { receiveGoods, stockDrift } from './inventory';
import { unbalancedEntries } from './ledger';
import { createCustomer, createSupplier } from './parties';
import {
  applySupplierAdvance, createPurchaseInvoice, createPurchaseReturn, openSupplierItems, paySupplier, reverseSupplierPayment,
  supplierAccount, supplierAgeing, supplierControls,
} from './purchasing';
import { createRefund } from './refunds';
import { finalizeSale, receiptData } from './sales';
import { openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number; // 50.00 SAR incl. VAT
let ahmed: number;
let shift: number;
let k = 0;
const key = () => `cr-key-${++k}-xxxx`;
const DAY = 86_400_000;
const TODAY = '2026-11-05';
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
const controls = () => {
  expect(unbalancedEntries(ctx)).toEqual([]);
  expect(stockDrift(ctx)).toEqual([]);
  expect(creditControls(ctx)).toMatchObject({ ok: true });
  expect(supplierControls(ctx)).toMatchObject({ ok: true });
};
/** A sale of n items (50.00 each). pay = paid now in cash; the rest on Ahmed's account. */
const creditSale = (n: number, pay: number, opts: { user?: number; approver?: number; customer?: number } = {}) => {
  const total = n * 5_000;
  return finalizeSale(ctx, opts.user ?? u.cashier, {
    idempotencyKey: key(),
    customerId: opts.customer ?? ahmed,
    lines: [{ productId: item, qty: n * 1000 }],
    payments: [...(pay ? [{ tender: 'cash' as const, amount: pay }] : []), ...(total - pay ? [{ tender: 'account' as const, amount: total - pay }] : [])],
    creditApproverId: opts.approver,
  });
};
const invOf = (saleId: number) => customerAccount(ctx, u.admin, ahmed).invoices.find((i) => i.saleId === saleId)!;
const pay = (amount: number, allocations: { saleId: number; amount: number }[], method: 'cash' | 'card' | 'bank' = 'cash', requestKey = key()) =>
  recordCustomerReceipt(ctx, u.cashier === undefined ? u.admin : method === 'bank' ? u.supervisor : u.cashier, { requestKey, customerId: ahmed, amount, method, allocations });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'ITEM', nameEn: 'Item', nameAr: 'صنف', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 5_000 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Stock Co' }), lines: [{ productId: item, qty: 1_000_000, unitCost: 3_000 }] });
  ahmed = createCustomer(ctx, u.cashier, { name: 'Ahmed', phone: '0500000001' });
  updateCustomerCredit(ctx, u.admin, { customerId: ahmed, creditEnabled: true, creditLimit: 100_000, paymentTermsDays: 30 });
  shift = openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('customer credit sales', () => {
  it('1–3: fully paid, fully on credit, partly paid; revenue once; receipt shows paid now and remaining', () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), customerId: ahmed, lines: [{ productId: item, qty: 5000 }], payments: [{ tender: 'cash', amount: 25_000 }] }); // fully paid: no receivable
    const full = creditSale(5, 0); // 250.00 on account
    const part = creditSale(5, 10_000); // 100.00 now, 150.00 on account
    expect(invOf(full.saleId)).toMatchObject({ amount: 25_000, open: 25_000, status: 'unpaid', dueDate: '2026-12-05' });
    expect(invOf(part.saleId)).toMatchObject({ amount: 15_000, paidAtSale: 10_000, open: 15_000 });
    expect(acct('1100')).toBe(40_000);
    expect(acct('4000')).toBe(-3 * 21_739); // 250.00 incl. = 217.39 excl. each, recognised once
    expect(shiftSummary(ctx, shift).expectedCash).toBe(25_000 + 10_000);
    const r = receiptData(ctx, part.saleId);
    expect(r.payments).toEqual([{ tender: 'cash', amount: 10_000 }, { tender: 'account', amount: 15_000 }]);
    controls();
  });

  it('a credit sale needs a customer, credit enabled, and paid-now + on-account equal to the bill', () => {
    expect(err(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'account', amount: 5_000 }] }))).toBe('VALIDATION');
    const other = createCustomer(ctx, u.cashier, { name: 'No Credit', phone: '0500000002' });
    expect(err(() => creditSale(1, 0, { customer: other }))).toBe('PERMISSION_DENIED');
    expect(err(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), customerId: ahmed, lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount: 3_000 }, { tender: 'account', amount: 3_000 }] }))).toBe('VALIDATION');
  });

  it('12–13: credit limit: refused over the limit; a supervisor override is allowed and recorded; repeated Enter makes one sale', () => {
    creditSale(14, 0); // 700.00 of the 1,000.00 limit
    expect(err(() => creditSale(8, 0))).toBe('PERMISSION_DENIED'); // 400.00 > 300.00 available
    expect(err(() => creditSale(8, 0, { approver: u.cashier }))).toBe('PERMISSION_DENIED');
    const s = creditSale(8, 0, { approver: u.supervisor });
    expect((ctx.db.prepare('SELECT override_by FROM receivables WHERE sale_id = ?').get(s.saleId) as { override_by: number }).override_by).toBe(u.supervisor);
    const keyOnce = key();
    const sale = () => finalizeSale(ctx, u.cashier, { idempotencyKey: keyOnce, customerId: ahmed, lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'account', amount: 5_000 }], creditApproverId: u.supervisor });
    expect(sale().replayed).toBe(false);
    expect(sale().replayed).toBe(true);
    expect(customerAccount(ctx, u.admin, ahmed).available).toBe(100_000 - 70_000 - 40_000 - 5_000);
    // no fixed limit for a trusted customer
    updateCustomerCredit(ctx, u.admin, { customerId: ahmed, creditEnabled: true, creditLimit: null, paymentTermsDays: 30 });
    creditSale(40, 0);
    controls();
  });
});

describe('customer payments and allocation', () => {
  it('4: invoice 250, pays 100 at the till, then 50, 60 and 40 later; four separate records; paid at the end', () => {
    const s = creditSale(5, 10_000);
    pay(5_000, [{ saleId: s.saleId, amount: 5_000 }]);
    t.advance(4 * DAY);
    pay(6_000, [{ saleId: s.saleId, amount: 6_000 }]);
    t.advance(3 * DAY);
    pay(4_000, [{ saleId: s.saleId, amount: 4_000 }]);
    expect(invOf(s.saleId)).toMatchObject({ open: 0, status: 'paid', allocated: 15_000 });
    const st = customerStatement(ctx, u.admin, ahmed);
    expect(st.lines.map((l) => [l.description, l.debit, l.credit, l.balance])).toEqual([
      ['Credit sale', 25_000, 0, 25_000], ['Paid at the till', 0, 10_000, 15_000], ['Payment', 0, 5_000, 10_000], ['Payment', 0, 6_000, 4_000], ['Payment', 0, 4_000, 0],
    ]);
    expect(acct('1100')).toBe(0);
    controls();
  });

  it('5–6: several unpaid invoices; one payment of 300 split by the cashier; oldest-first suggestion shown, not forced', () => {
    const a = creditSale(2, 0); // 100
    const b = creditSale(5, 0); // 250
    const c = creditSale(3, 0); // 150
    expect(suggestCustomerAllocation(ctx, u.cashier, ahmed, 30_000)).toEqual([{ saleId: a.saleId, amount: 10_000 }, { saleId: b.saleId, amount: 20_000 }]);
    pay(30_000, [{ saleId: a.saleId, amount: 10_000 }, { saleId: c.saleId, amount: 15_000 }, { saleId: b.saleId, amount: 5_000 }]);
    expect([invOf(a.saleId).status, invOf(b.saleId).status, invOf(c.saleId).status]).toEqual(['paid', 'partial', 'paid']);
    expect(customerAccount(ctx, u.admin, ahmed).outstanding).toBe(20_000);
    expect(err(() => pay(30_000, [{ saleId: b.saleId, amount: 30_000 }]))).toBe('VALIDATION'); // more than owed on that invoice
    controls();
  });

  it('7–8: overpayment becomes an advance (liability 2300, not income); applied to a later purchase', () => {
    const a = creditSale(2, 0);
    const r = pay(15_000, [{ saleId: a.saleId, amount: 10_000 }]);
    expect(r.advance).toBe(5_000);
    expect(acct('2300')).toBe(-5_000);
    expect(profitAndLoss(ctx, u.admin, TODAY, TODAY).netSales).toBe(8_696); // only the 100.00 sale
    const b = creditSale(2, 0);
    applyCustomerAdvance(ctx, u.supervisor, ahmed, [{ saleId: b.saleId, amount: 5_000 }]);
    expect(invOf(b.saleId)).toMatchObject({ open: 5_000, status: 'partial' });
    expect(acct('2300')).toBe(0);
    expect(err(() => applyCustomerAdvance(ctx, u.supervisor, ahmed, [{ saleId: b.saleId, amount: 1 }]))).toBe('VALIDATION'); // no advance left
    controls();
  });

  it('14–15: a double-clicked payment records once; a reversed payment restores the debt; the till is corrected', () => {
    const a = creditSale(4, 0);
    const rk = key();
    const p1 = pay(10_000, [{ saleId: a.saleId, amount: 10_000 }], 'cash', rk);
    expect(pay(10_000, [{ saleId: a.saleId, amount: 10_000 }], 'cash', rk).replayed).toBe(true);
    expect(shiftSummary(ctx, shift)).toMatchObject({ cashCollections: 10_000, expectedCash: 10_000 });
    expect(err(() => reverseCustomerReceipt(ctx, u.cashier, p1.receiptId, key(), 'wrong'))).toBe('PERMISSION_DENIED');
    reverseCustomerReceipt(ctx, u.admin, p1.receiptId, key(), 'Counted twice');
    expect(invOf(a.saleId).open).toBe(20_000);
    expect(shiftSummary(ctx, shift)).toMatchObject({ cashCollections: 0, expectedCash: 0 });
    controls();
  });

  it('9–11: refunds on a credit invoice reduce the debt first, cash only for what was already paid; a full refund cancels it', () => {
    const s = creditSale(5, 10_000); // paid 100 now, 150 owed
    // Return 2 of 5 (100.00): all of it comes off what is owed; no cash
    const r1 = createRefund(ctx, u.supervisor, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'Return', lines: [{ saleLineNo: 1, qty: 2000, restock: true }] });
    expect(r1).toMatchObject({ totalIncl: 10_000, accountOffset: 10_000, cashOut: 0 });
    expect(invOf(s.saleId).open).toBe(5_000);
    // Return the other 3 (150.00): 50.00 off the debt, 100.00 cash back (what was paid at the till)
    const r2 = createRefund(ctx, u.supervisor, { requestKey: key(), invoiceNo: s.invoiceNo, reason: 'Return', lines: [{ saleLineNo: 1, qty: 3000, restock: true }] });
    expect(r2).toMatchObject({ accountOffset: 5_000, cashOut: 10_000 });
    expect(invOf(s.saleId)).toMatchObject({ open: 0, status: 'paid' });
    expect(shiftSummary(ctx, shift)).toMatchObject({ cashRefunds: 10_000, expectedCash: 0 });
    controls();
  });

  it('16–17: no due date is never overdue; overdue invoice partly paid stays in the right ageing bucket; dispute and write-off', () => {
    const late = creditSale(4, 0); // due 2026-12-05
    updateCustomerCredit(ctx, u.admin, { customerId: ahmed, creditEnabled: true, creditLimit: 100_000, paymentTermsDays: null });
    const open = creditSale(2, 0); // no due date
    t.advance(45 * DAY); // 2026-12-20
    expect(invOf(open.saleId).status).toBe('no_due');
    expect(invOf(late.saleId).status).toBe('overdue');
    pay(5_000, [{ saleId: late.saleId, amount: 5_000 }]);
    const [row] = receivablesAgeing(ctx, u.admin);
    expect(row).toMatchObject({ outstanding: 25_000, mostOverdueInvoice: late.invoiceNo });
    expect(row!.buckets).toMatchObject({ d1_30: 15_000, noDue: 10_000, notDue: 0 });
    setInvoiceDispute(ctx, u.admin, open.saleId, true, 'Customer says items missing');
    expect(invOf(open.saleId).status).toBe('disputed');
    expect(err(() => writeOffInvoice(ctx, u.supervisor, { requestKey: key(), saleId: late.saleId, amount: 1_000, reason: 'x' }))).toBe('PERMISSION_DENIED');
    writeOffInvoice(ctx, u.admin, { requestKey: key(), saleId: late.saleId, amount: 15_000, reason: 'Customer left the country' });
    expect(invOf(late.saleId).status).toBe('paid');
    expect(acct('6910')).toBe(15_000);
    controls();
  });

  it('26: a failure in the middle of a payment saves nothing', () => {
    const a = creditSale(2, 0);
    expect(err(() => pay(10_000, [{ saleId: a.saleId, amount: 6_000 }, { saleId: a.saleId, amount: 4_000 }]))).toBe('VALIDATION');
    expect((ctx.db.prepare('SELECT count(*) AS n FROM customer_receipts').get() as { n: number }).n).toBe(0);
    expect(invOf(a.saleId).open).toBe(10_000);
  });

  it('25: a cashier cannot change limits, reverse payments, write off, take bank payments or see statements', () => {
    expect(err(() => updateCustomerCredit(ctx, u.cashier, { customerId: ahmed, creditEnabled: true, creditLimit: 9_999_999, paymentTermsDays: 30 }))).toBe('PERMISSION_DENIED');
    expect(err(() => recordCustomerReceipt(ctx, u.cashier, { requestKey: key(), customerId: ahmed, amount: 100, method: 'bank', allocations: [] }))).toBe('PERMISSION_DENIED');
    expect(err(() => customerStatement(ctx, u.cashier, ahmed))).toBe('PERMISSION_DENIED');
    expect(err(() => receivablesAgeing(ctx, u.cashier))).toBe('PERMISSION_DENIED');
  });
});

describe('supplier credit', () => {
  let sup: number;
  const inv = (net: number, o: Record<string, unknown> = {}) =>
    createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: `S-${k}`, supplierVatNo: VATNO, invoiceDate: TODAY, grnIds: [], newLines: [{ productId: item, qty: 1000, unitCost: net }], invoiceNet: net, vatAmount: 0, vatRecoverable: false, ...o });
  beforeEach(() => {
    sup = createSupplier(ctx, u.admin, { name: 'Dairy Co', vatNumber: VATNO, paymentTermsDays: 30 });
  });

  it('18–20 + D: 2,000 on credit, paid 500 at once, then 500, 600, 400; one payment can settle several invoices', () => {
    const a = inv(200_000, { payNow: { requestKey: key(), amount: 50_000, method: 'bank' } });
    for (const amt of [50_000, 60_000, 40_000]) paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: amt, method: 'bank', paidOn: TODAY, allocations: [{ invoiceId: a.invoiceId, amount: amt }] });
    expect(openSupplierItems(ctx, sup)).toEqual([]);
    const b = inv(30_000);
    const c = inv(20_000);
    paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 40_000, method: 'bank', paidOn: TODAY, allocations: [{ invoiceId: b.invoiceId, amount: 30_000 }, { invoiceId: c.invoiceId, amount: 10_000 }] });
    const acc = supplierAccount(ctx, u.admin, sup);
    expect(acc).toMatchObject({ outstanding: 10_000, partialCount: 1, unpaidCount: 0, totalPurchases: 250_000, totalPayments: 240_000 });
    expect(acc.items.find((i) => i.invoiceId === c.invoiceId)!.status).toBe('partial');
    controls();
  });

  it('21: an advance before delivery is an asset (1310), applied when the invoice arrives; reversing it undoes everything', () => {
    const p = paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 30_000, method: 'bank', paidOn: TODAY, allocations: [], allowAdvance: true });
    expect(acct('1310')).toBe(30_000);
    expect(err(() => paySupplier(ctx, u.admin, { requestKey: key(), supplierId: sup, amount: 1, method: 'bank', paidOn: TODAY, allocations: [] }))).toBe('VALIDATION'); // not allowed silently
    const a = inv(50_000);
    applySupplierAdvance(ctx, u.admin, sup, [{ invoiceId: a.invoiceId, amount: 30_000 }]);
    expect(openSupplierItems(ctx, sup)[0]!.open).toBe(20_000);
    expect(acct('1310')).toBe(0);
    reverseSupplierPayment(ctx, u.admin, p.paymentId, key(), 'Cancelled order');
    expect(openSupplierItems(ctx, sup)[0]!.open).toBe(50_000);
    controls();
  });

  it('22–24: return credit taken off the chosen invoice; the same goods receipt cannot be invoiced twice; no due date never overdue', () => {
    const a = inv(40_000);
    createPurchaseReturn(ctx, u.admin, { requestKey: key(), supplierId: sup, returnDate: TODAY, reason: 'Damaged', lines: [{ productId: item, qty: 1000 }], creditNet: 3_000, vatAmount: 0, vatRecoverable: false, invoiceId: a.invoiceId });
    expect(openSupplierItems(ctx, sup)[0]!.open).toBe(37_000);
    const g = receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: item, qty: 1000, unitCost: 1_000 }] }).grnId;
    createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: 'G1', invoiceDate: TODAY, grnIds: [g], invoiceNet: 1_000, vatAmount: 0, vatRecoverable: false, noDueDate: true, arrangementNote: 'Collects at the next delivery' });
    expect(err(() => createPurchaseInvoice(ctx, u.admin, { requestKey: key(), supplierId: sup, supplierInvoiceNo: 'G2', invoiceDate: TODAY, grnIds: [g], invoiceNet: 1_000, vatAmount: 0, vatRecoverable: false }))).toBe('CONFLICT');
    t.advance(100 * DAY);
    const [row] = supplierAgeing(ctx, u.admin, '2027-02-13');
    expect(row).toMatchObject({ noDue: 1_000, d61_90: 37_000, mostOverdue: 'PI-000001' });
    controls();
  });
});

describe('dashboard, recovery and migration', () => {
  it('owner KPIs show receivables, advances and payables separately from cash', () => {
    const a = creditSale(4, 5_000);
    pay(5_000, [{ saleId: a.saleId, amount: 5_000 }]);
    recordCustomerReceipt(ctx, u.cashier, { requestKey: key(), customerId: ahmed, amount: 2_000, method: 'cash', allocations: [] });
    const kp = ownerKpis(ctx, u.admin, TODAY, TODAY);
    expect(kp).toMatchObject({ receivablesOutstanding: 10_000, customerAdvances: 2_000, collectionsInPeriod: 7_000 });
    expect(kp.cashCollected).toBe(5_000); // cash taken at sales only; collections are shown separately
  });

  it('27: a backup copy reopens with every balance and control still consistent', () => {
    const a = creditSale(4, 0);
    pay(5_000, [{ saleId: a.saleId, amount: 5_000 }]);
    const dir = mkdtempSync(join(tmpdir(), 'pos-cr-'));
    const copy = join(dir, 'copy.db');
    ctx.db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    const db2 = openDatabase(copy);
    const ctx2: Ctx = { db: db2, now: ctx.now, uuid: ctx.uuid };
    expect(creditControls(ctx2)).toMatchObject({ ok: true, receivablesOpen: 15_000 });
    db2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('migration 10 keeps every existing payment row (the payments table is rebuilt)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-m10-'));
    const db = new Database(join(dir, 'pos.db'));
    db.pragma('foreign_keys = ON');
    migrate(db, MIGRATIONS.slice(0, 9));
    db.exec(`INSERT INTO users (username, display_name, pin_hash, pin_salt, created_at) VALUES ('x','X','h','s','2026-01-01');
      INSERT INTO register_shifts (user_id, opened_at, opening_float, status) VALUES (1, '2026-01-01', 0, 'open');
      INSERT INTO sales (invoice_no, uuid, idempotency_key, shift_id, user_id, total_incl, total_vat, total_excl, total_discount, paid_total, change_given, created_at)
        VALUES ('INV-1','u1','k1',1,1,1000,130,870,0,1000,0,'2026-01-01');
      INSERT INTO payments (sale_id, tender, amount) VALUES (1,'cash',600),(1,'card',400);`);
    migrate(db);
    expect(db.prepare('SELECT tender, amount FROM payments ORDER BY id').all()).toEqual([{ tender: 'cash', amount: 600 }, { tender: 'card', amount: 400 }]);
    expect(() => db.prepare('DELETE FROM payments').run()).toThrow(/immutable/);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
