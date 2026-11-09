// Prepaid expenses are only recognised when an authorised person confirms it. Every name here is made up.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError, type Ctx } from './context';
import { createExpense, listCategories, postExpense, prepaidPreview, recognizePrepaidMonth } from './expenses';
import { balanceSheet, datedTrialBalance, ownerKpis, profitAndLoss } from './financials';
import { unbalancedEntries } from './ledger';
import { makeTestCtx, seedUsers } from './test-helpers';
import { vatSummary } from './vat-report';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let n = 0;
const key = () => `pre-key-${++n}-xxxx`;
const DAY = 86_400_000;
const entries = () => (ctx.db.prepare('SELECT count(*) AS c FROM journal_entries').get() as { c: number }).c;
const acct = (code: string) => {
  const r = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31').rows.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};
const yearly = (o: { periodStart?: string; periodEnd?: string } = {}) => {
  const categoryId = listCategories(ctx, u.admin).find((c) => c.nameEn === 'Rent')!.id;
  const id = createExpense(ctx, u.admin, { requestKey: key(), categoryId, description: 'Made up rent', payee: 'Landlord', expenseDate: '2026-11-05', gross: 1_200_001, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false, periodStart: '2026-11', periodEnd: '2027-10', ...o });
  postExpense(ctx, u.admin, id);
  return id;
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('prepaid recognition', () => {
  it('posting a prepaid expense puts it all in 1300 and recognises nothing', () => {
    yearly();
    expect(acct('1300')).toBe(1_200_001);
    expect(acct('6100')).toBe(0);
  });

  it('opening any report creates no journal entry', () => {
    yearly();
    const before = entries();
    profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-30');
    balanceSheet(ctx, u.admin, '2026-11-30');
    vatSummary(ctx, u.admin, '2026-11-01', '2026-11-30');
    ownerKpis(ctx, u.admin, '2026-11-01', '2026-11-30');
    prepaidPreview(ctx, u.admin, '2026-11');
    expect(entries()).toBe(before);
  });

  it('reports say how much is waiting', () => {
    yearly();
    const pl = profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-30');
    expect(pl.prepaidWaiting).toBe(100_001);
    expect(pl.provisionalReasons.join(' ')).toMatch(/prepaid/i);
    expect(balanceSheet(ctx, u.admin, '2026-11-30').prepaidWaiting).toBe(100_001);
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 100_001 });
    expect(profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-30').prepaidWaiting).toBe(0);
  });

  it('the preview shows value, period, amount, what remains and the proposed entry', () => {
    yearly();
    const p = prepaidPreview(ctx, u.admin, '2026-11');
    expect(p.total).toBe(100_001);
    expect(p.lines).toEqual([expect.objectContaining({ description: 'Made up rent', original: 1_200_001, periodStart: '2026-11', periodEnd: '2027-10', month: '2026-11', amount: 100_001, remaining: 1_100_000, debitAccount: '6100', creditAccount: '1300' })]);
  });

  it('confirming posts once; running it again adds nothing', () => {
    yearly();
    expect(recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 100_001 }).posted).toBe(1);
    expect(acct('1300')).toBe(1_100_000);
    expect(acct('6100')).toBe(100_001);
    const before = entries();
    expect(recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 0 }).posted).toBe(0);
    expect(entries()).toBe(before);
    expect(unbalancedEntries(ctx)).toEqual([]);
  });

  it('the same request key replays without posting', () => {
    yearly();
    const k = key();
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: k, expectedTotal: 100_001 });
    const before = entries();
    expect(recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: k, expectedTotal: 100_001 }).replayed).toBe(true);
    expect(entries()).toBe(before);
  });

  it('refuses when the figures changed after the preview', () => {
    yearly();
    expect(code(() => recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 999 }))).toBe('CONFLICT');
    expect(acct('1300')).toBe(1_200_001);
  });

  it('a later month catches up the earlier months, each once', () => {
    yearly();
    t.advance(31 * DAY);
    expect(prepaidPreview(ctx, u.admin, '2026-12').lines.map((l) => l.month)).toEqual(['2026-11', '2026-12']);
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-12', requestKey: key(), expectedTotal: 200_001 });
    expect(acct('1300')).toBe(1_000_000);
  });

  it('a future month cannot be recognised', () => {
    yearly();
    expect(code(() => recognizePrepaidMonth(ctx, u.admin, { month: '2026-12', requestKey: key(), expectedTotal: 200_001 }))).toBe('VALIDATION');
  });

  it('a cashier cannot do it, and the run is audited', () => {
    yearly();
    expect(code(() => recognizePrepaidMonth(ctx, u.cashier, { month: '2026-11', requestKey: key(), expectedTotal: 100_001 }))).toBe('PERMISSION_DENIED');
    recognizePrepaidMonth(ctx, u.admin, { month: '2026-11', requestKey: key(), expectedTotal: 100_001 });
    expect(ctx.db.prepare("SELECT count(*) AS c FROM audit_log WHERE action = 'expense.amortize'").get()).toEqual({ c: 1 });
  });
});
