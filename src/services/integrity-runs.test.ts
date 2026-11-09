import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { latestIntegrity, reviewFinding, runIntegrity } from './integrity-runs';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
/** A fault that survives between runs: a stock balance with no movements. */
const breakStock = () => {
  const id = createProduct(ctx, u.admin, { sku: 'BAD', nameEn: 'Bad', nameAr: 'سيء', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 100 });
  ctx.db.prepare('INSERT INTO stock_balances (product_id, qty, avg_cost) VALUES (?, 1000, 0) ON CONFLICT (product_id) DO UPDATE SET qty = 1000').run(id);
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('running the books check', () => {
  it('a clean run saves no findings and is audited', () => {
    const r = runIntegrity(ctx, u.admin);
    expect(r.findings).toEqual([]);
    expect(count('integrity_runs')).toBe(1);
    expect(ctx.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'integrity.run'").get()).toEqual({ n: 1 });
  });

  it('a run saves its findings', () => {
    breakStock();
    const r = runIntegrity(ctx, u.admin);
    expect(r.findings.map((f) => f.checkId)).toContain('stock_movements');
    expect(latestIntegrity(ctx, u.admin)!.id).toBe(r.id);
    expect(count('integrity_findings')).toBeGreaterThan(0);
  });

  it('needs integrity.view; cashier and supervisor refused', () => {
    for (const who of [u.cashier, u.supervisor]) {
      expect(() => runIntegrity(ctx, who)).toThrow();
      expect(() => latestIntegrity(ctx, who)).toThrow();
      expect(() => reviewFinding(ctx, who, 'x', 'y')).toThrow();
    }
  });

  it('a note follows the same finding into the next run', () => {
    breakStock();
    const f = runIntegrity(ctx, u.admin).findings[0]!;
    reviewFinding(ctx, u.admin, f.fingerprint, 'Being looked at');
    t.advance(1000);
    const next = runIntegrity(ctx, u.admin).findings.find((x) => x.fingerprint === f.fingerprint)!;
    expect(next.reviews).toMatchObject([{ note: 'Being looked at', by: 'Admin' }]);
  });

  it('a note does not remove the finding', () => {
    breakStock();
    const first = runIntegrity(ctx, u.admin).findings;
    reviewFinding(ctx, u.admin, first[0]!.fingerprint, 'Seen');
    expect(runIntegrity(ctx, u.admin).findings).toHaveLength(first.length);
  });

  it('a note is audited and needs text', () => {
    expect(() => reviewFinding(ctx, u.admin, 'abc', ' ')).toThrow();
    reviewFinding(ctx, u.admin, 'abc', 'Note');
    expect(ctx.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'integrity.review'").get()).toEqual({ n: 1 });
  });

  it('a run changes no financial table', () => {
    const tables = ['sales', 'journal_entries', 'journal_lines', 'payments', 'stock_movements', 'stock_balances'];
    const before = tables.map(count);
    runIntegrity(ctx, u.admin);
    expect(tables.map(count)).toEqual(before);
  });

  it('nothing has been run yet', () => expect(latestIntegrity(ctx, u.admin)).toBeNull());
});
