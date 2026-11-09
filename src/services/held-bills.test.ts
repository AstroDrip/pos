import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct, setPrice, setProductActive } from './catalog';
import type { Ctx } from './context';
import { cancelHeldBill, holdBill, hydrateBill, listHeldBills, recallBill } from './held-bills';
import { createCustomer } from './parties';
import { makeTestCtx, seedUsers } from './test-helpers';
import { createUser } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number;
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const line = (o = {}) => ({ productId: item, qty: 2000, seenPrice: 1000, ...o });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
});
afterEach(() => t.cleanup());

describe('holding a bill', () => {
  it('holding creates no sale, payment, stock movement, journal entry or invoice', () => {
    holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    for (const table of ['sales', 'payments', 'stock_movements', 'journal_entries']) expect(count(table), table).toBe(0);
  });

  it('recall returns discount, scanCode, cash, card, customer', () => {
    const customerId = createCustomer(ctx, u.admin, { name: 'Amal', phone: '0500000001' });
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line({ discount: 150, scanCode: '2000001000005' })], customerId, cash: '50.00', card: '10', billKey: 'bill-key-0001' });
    const b = hydrateBill(ctx, recallBill(ctx, u.cashier, id));
    expect(b.lines[0]).toMatchObject({ qty: 2000, discount: 150, scanCode: '2000001000005', seenPrice: 1000 });
    expect(b.customer).toMatchObject({ id: customerId, name: 'Amal' });
    expect(b).toMatchObject({ cash: '50.00', card: '10', billKey: 'bill-key-0001', dropped: [] });
  });

  it('an old-format hold still loads', () => {
    ctx.db.prepare('INSERT INTO held_bills (label, payload_json, user_id, created_at) VALUES (?, ?, ?, ?)').run('Old', JSON.stringify({ lines: [{ productId: item, qty: 1000 }] }), u.cashier, ctx.now());
    const id = listHeldBills(ctx)[0]!.id;
    const b = hydrateBill(ctx, recallBill(ctx, u.cashier, id));
    expect(b).toMatchObject({ customer: null, cash: '', card: '' });
    expect(b.lines[0]).toMatchObject({ qty: 1000, discount: 0 });
    expect(b.lines[0]!.seenPrice).toBeUndefined();
  });

  it('a re-priced item comes back at the new price with seenPrice set', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    setPrice(ctx, u.admin, item, 1200);
    const b = hydrateBill(ctx, recallBill(ctx, u.cashier, id));
    expect(b.lines[0]!.product.priceIncl).toBe(1200);
    expect(b.lines[0]!.seenPrice).toBe(1000);
  });

  it('a discount bigger than the new line total is kept', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line({ qty: 1000, discount: 900 })] });
    setPrice(ctx, u.admin, item, 500);
    expect(hydrateBill(ctx, recallBill(ctx, u.cashier, id)).lines[0]!.discount).toBe(900);
  });

  it('a turned-off item is left off and named', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    setProductActive(ctx, u.admin, item, false, 'Stopped');
    const b = hydrateBill(ctx, recallBill(ctx, u.cashier, id));
    expect(b.lines).toEqual([]);
    expect(b.dropped).toEqual(['Apple']);
  });

  it('refuses typed amounts that are not money', () => {
    expect(() => holdBill(ctx, u.cashier, 'Bill', { lines: [line()], cash: '12z' })).toThrow();
  });
});

describe('cancelling a held bill', () => {
  it('cancel removes the hold and is audited with the reason', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    cancelHeldBill(ctx, u.cashier, id, 'Customer left');
    expect(listHeldBills(ctx)).toEqual([]);
    const row = ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'bill.cancel'").get() as { details_json: string };
    expect(JSON.parse(row.details_json)).toMatchObject({ reason: 'Customer left' });
    expect(() => cancelHeldBill(ctx, u.cashier, id, 'Again')).toThrow(/not found/i);
  });

  it('cancel needs a reason', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    expect(() => cancelHeldBill(ctx, u.cashier, id, '  ')).toThrow();
  });

  it('cancel needs sale.create', () => {
    const id = holdBill(ctx, u.cashier, 'Bill', { lines: [line()] });
    const nobody = createUser(ctx, u.admin, { username: 'none', displayName: 'None', pin: '3333', roles: [] });
    expect(() => cancelHeldBill(ctx, nobody, id, 'x')).toThrow();
  });
});
