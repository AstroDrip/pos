import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { clearDraft, discardDraft, loadDraft, markDraftRestored, saveDraft } from './drafts';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { createUser } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number;
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const bill = (billKey = 'draft-bill-0001') => JSON.stringify({ lines: [{ productId: item, qty: 1000 }], billKey });
const actions = () => (ctx.db.prepare('SELECT action FROM audit_log').all() as { action: string }[]).map((r) => r.action);

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
});
afterEach(() => t.cleanup());

describe('bills left open', () => {
  it('a draft creates no sale, stock or ledger row', () => {
    saveDraft(ctx, u.cashier, 'sale', bill());
    for (const table of ['sales', 'payments', 'stock_movements', 'journal_entries']) expect(count(table), table).toBe(0);
  });

  it('one draft per user and kind; saving replaces it', () => {
    saveDraft(ctx, u.cashier, 'sale', bill('draft-bill-0001'));
    saveDraft(ctx, u.cashier, 'sale', bill('draft-bill-0002'));
    expect(count('bill_drafts')).toBe(1);
    expect(loadDraft(ctx, u.cashier, 'sale')!.json).toContain('draft-bill-0002');
  });

  it("another user's draft is not returned", () => {
    saveDraft(ctx, u.cashier, 'sale', bill());
    expect(loadDraft(ctx, u.supervisor, 'sale')).toBeNull();
  });

  it('sale kind needs sale.create; supplier_bill needs purchase.manage', () => {
    const nobody = createUser(ctx, u.admin, { username: 'none', displayName: 'None', pin: '3333', roles: [] });
    expect(() => saveDraft(ctx, nobody, 'sale', bill())).toThrow();
    expect(() => saveDraft(ctx, u.cashier, 'supplier_bill', '{}')).toThrow(/purchase\.manage/);
    expect(() => loadDraft(ctx, u.cashier, 'supplier_bill')).toThrow(/purchase\.manage/);
  });

  it('a draft whose bill key is already a sale is removed and returns null', () => {
    receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Farm' }), lines: [{ productId: item, qty: 10_000, unitCost: 500 }] });
    openShift(ctx, u.cashier, 0);
    saveDraft(ctx, u.cashier, 'sale', bill('draft-bill-sold'));
    finalizeSale(ctx, u.cashier, { idempotencyKey: 'draft-bill-sold', lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
    expect(loadDraft(ctx, u.cashier, 'sale')).toBeNull();
    expect(count('bill_drafts')).toBe(0);
  });

  it('corrupt JSON is removed and returns null', () => {
    saveDraft(ctx, u.cashier, 'sale', '{oops');
    expect(loadDraft(ctx, u.cashier, 'sale')).toBeNull();
    expect(count('bill_drafts')).toBe(0);
  });

  it('an old or wrong shape is removed and returns null', () => {
    saveDraft(ctx, u.cashier, 'sale', JSON.stringify({ lines: 'none' }));
    expect(loadDraft(ctx, u.cashier, 'sale')).toBeNull();
    expect(count('bill_drafts')).toBe(0);
  });

  it('a supplier bill draft of the wrong shape is removed and returns null', () => {
    for (const bad of ['{}', '{"key":"k","head":{},"paper":{},"rows":[]}', '{"key":"k","head":{"docNo":"1","supplierId":1},"paper":{},"rows":"none"}', '{"key":"k","head":{"docNo":"1","supplierId":1},"paper":{},"rows":[{"uid":"a"}]}']) {
      saveDraft(ctx, u.admin, 'supplier_bill', bad);
      expect(loadDraft(ctx, u.admin, 'supplier_bill'), bad).toBeNull();
      expect(count('bill_drafts')).toBe(0);
    }
  });

  it('a good supplier bill draft is kept', () => {
    saveDraft(ctx, u.admin, 'supplier_bill', JSON.stringify({ key: 'k', head: { docNo: 'INV-1', supplierId: 1 }, paper: {}, rows: [{ uid: 'a', product: { id: 1 } }] }));
    expect(loadDraft(ctx, u.admin, 'supplier_bill')).not.toBeNull();
  });

  it('a very large draft is refused', () => expect(() => saveDraft(ctx, u.cashier, 'sale', 'x'.repeat(200_001))).toThrow());

  it('clearing is silent; restore and discard are audited', () => {
    saveDraft(ctx, u.cashier, 'sale', bill());
    clearDraft(ctx, u.cashier, 'sale');
    expect(actions()).not.toContain('bill.draft_discarded');
    saveDraft(ctx, u.cashier, 'sale', bill());
    markDraftRestored(ctx, u.cashier, 'sale');
    discardDraft(ctx, u.cashier, 'sale');
    expect(actions()).toEqual(expect.arrayContaining(['bill.draft_restored', 'bill.draft_discarded']));
    expect(count('bill_drafts')).toBe(0);
  });
});
