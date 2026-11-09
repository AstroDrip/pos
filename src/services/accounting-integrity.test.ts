// Fixed made-up transactions, with every figure worked out by hand. Provisional accounting: this proves the sums, not the policy.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { createExpense, listCategories, postExpense, recognizePrepaidMonth } from './expenses';
import { balanceSheet, cashFlowData, datedTrialBalance, generalLedger, profitAndLoss } from './financials';
import { CHECKS, runChecks } from './integrity';
import { receiveGoods } from './inventory';
import { postEntry } from './ledger';
import { createSupplier } from './parties';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let n = 0;
const key = () => `acct-key-${++n}-xxxx`;
const DAY = '2026-11-05';

const expenseInput = (categoryId: number, o: object = {}) => ({ requestKey: key(), categoryId, description: 'Made up', payee: 'Made Up Co', expenseDate: DAY, gross: 30_000, vatClass: 'out_of_scope' as const, vatAmount: 0, vatRecoverable: false, ...o });
const rent = () => listCategories(ctx, u.admin).find((c) => c.nameEn === 'Rent')!.id;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('new books checks', () => {
  it('are listed', () => {
    const ids = CHECKS.map((c) => c.id);
    for (const id of ['vat_claims', 'prepaid_balance', 'expense_accounts']) expect(ids).toContain(id);
  });

  it('a VAT entry with no claim behind it is reported', () => {
    expect(runChecks(ctx).filter((f) => f.checkId === 'vat_claims')).toEqual([]);
    postEntry(ctx, { date: DAY, sourceType: 'vat_claim', sourceId: 999, memo: 'planted', lines: [{ account: '2210', debit: 500 }, { account: '5010', credit: 500 }] });
    expect(runChecks(ctx).filter((f) => f.checkId === 'vat_claims')).toHaveLength(1);
  });

  it('money in 1300 that no prepaid expense explains is reported; a healthy prepaid is not', () => {
    const id = createExpense(ctx, u.admin, expenseInput(rent(), { gross: 300_000, periodStart: '2026-11', periodEnd: '2027-01' }));
    postExpense(ctx, u.admin, id);
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 100_000 });
    expect(runChecks(ctx).filter((f) => f.checkId === 'prepaid_balance')).toEqual([]);
    postEntry(ctx, { date: DAY, sourceType: 'demo_opening', sourceId: 77, memo: 'planted', lines: [{ account: '1300', debit: 900 }, { account: '3000', credit: 900 }] });
    expect(runChecks(ctx).filter((f) => f.checkId === 'prepaid_balance')).toHaveLength(1);
  });

  it('an expense posted to a sales or liability account is reported', () => {
    const cat = rent();
    expect(runChecks(ctx).filter((f) => f.checkId === 'expense_accounts')).toEqual([]);
    ctx.db.prepare("UPDATE expense_categories SET account_code = '4000' WHERE id = ?").run(cat);
    expect(runChecks(ctx).filter((f) => f.checkId === 'expense_accounts')).toHaveLength(1);
  });
});

describe('no data is not the same as zero', () => {
  it('an empty period says it has no records', () => {
    expect(profitAndLoss(ctx, u.admin, '2026-01-01', '2026-01-31').entryCount).toBe(0);
    expect(balanceSheet(ctx, u.admin, '2026-01-31').entryCount).toBe(0);
  });

  it('a period with records that net to zero is a real zero', () => {
    postEntry(ctx, { date: DAY, sourceType: 'demo_opening', sourceId: 1, memo: 'a', lines: [{ account: '1030', debit: 500 }, { account: '3000', credit: 500 }] });
    const pl = profitAndLoss(ctx, u.admin, DAY, DAY);
    expect(pl.entryCount).toBe(1);
    expect(pl.netProfit).toBe(0);
  });
});

describe('one worked example, by hand', () => {
  it('every statement agrees', () => {
    const p = createProduct(ctx, u.admin, { sku: 'X', nameEn: 'Item', nameAr: 'صنف', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1_150 });
    receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Made Up Supplier' }), lines: [{ productId: p, qty: 10_000, unitCost: 600 }] }); // 10 pieces at 6.00 = 60.00
    openShift(ctx, u.admin, 0);
    finalizeSale(ctx, u.admin, { idempotencyKey: key(), lines: [{ productId: p, qty: 2_000 }], payments: [{ tender: 'cash', amount: 2_300 }] }); // 2 at 11.50 = 23.00 incl, 20.00 excl, 3.00 VAT, cost 12.00
    postExpense(ctx, u.admin, createExpense(ctx, u.admin, expenseInput(rent(), { gross: 500 })));

    const pl = profitAndLoss(ctx, u.admin, DAY, DAY);
    expect(pl).toMatchObject({ netSales: 2_000, cogs: 1_200, grossProfit: 800, totalOperating: 500, netProfit: 300, outputVat: 300 });

    const tb = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31');
    expect(tb.totalDebit).toBe(tb.totalCredit);

    const bs = balanceSheet(ctx, u.admin, DAY);
    expect(bs.balanced).toBe(true);
    expect(bs.currentEarnings).toBe(300);
    expect(bs.assets.find((a) => a.code === '1200')?.amount).toBe(4_800);

    expect(generalLedger(ctx, u.admin, '1200', DAY, DAY).lines.length).toBeGreaterThan(0);
    expect(cashFlowData(ctx, DAY, DAY).net).toBe(2_300);
    expect(runChecks(ctx)).toEqual([]);
  });
});
