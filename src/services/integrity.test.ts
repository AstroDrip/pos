import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection';
import { seedDemoShop } from '../demo/seed';
import type { Ctx } from './context';
import { CHECKS, checkCashFlow, duplicatesIn, runChecks } from './integrity';
import { cashFlowData } from './financials';
import { makeTestCtx } from './test-helpers';

const NOW = '2026-11-08T14:30:00.000Z';
let master: ReturnType<typeof makeTestCtx>;
let dir: string;
let n = 0;
let ctx: Ctx;

beforeAll(() => {
  master = makeTestCtx();
  const c = { ...master.ctx, now: () => NOW };
  seedDemoShop(c, NOW);
  c.db.pragma('wal_checkpoint(TRUNCATE)');
  dir = mkdtempSync(join(tmpdir(), 'pos-integrity-'));
  copyFileSync(master.path, join(dir, 'master.db'));
}, 180_000);
afterAll(() => {
  master.cleanup();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  const p = join(dir, `copy-${++n}.db`);
  copyFileSync(join(dir, 'master.db'), p);
  ctx = { db: openDatabase(p), now: () => NOW, uuid: () => `u-${n}` };
});
afterEach(() => ctx.db.close());

/** Takes the guards off, only in this throwaway copy, so a fault can be made on purpose. */
const unlock = (...tables: string[]) => {
  for (const t of tables) ctx.db.exec(`DROP TRIGGER IF EXISTS trg_${t}_no_update; DROP TRIGGER IF EXISTS trg_${t}_no_delete;`);
};
const found = () => runChecks(ctx).map((f) => f.checkId);
const accountId = (code: string) => (ctx.db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;
const firstEntry = (source: string) => (ctx.db.prepare('SELECT id, source_id AS sourceId FROM journal_entries WHERE source_type = ? ORDER BY id LIMIT 1').get(source) as { id: number; sourceId: number });
/** Moves money between two accounts inside one entry, so the entry itself still balances. */
const shift = (entry: number, fromCode: string, toCode: string, amount: number, side: 'debit' | 'credit') => {
  unlock('journal_lines', 'journal_entries');
  ctx.db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)`).run(entry, accountId(fromCode), side === 'debit' ? amount : 0, side === 'credit' ? amount : 0);
  ctx.db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)`).run(entry, accountId(toCode), side === 'credit' ? amount : 0, side === 'debit' ? amount : 0);
};

describe('books check', () => {
  it('the clean demo shop has no findings', () => expect(runChecks(ctx)).toEqual([]));

  it('has every check in the spec', () => expect(CHECKS.map((c) => c.id)).toEqual(['je_balanced', 'tb_balanced', 'bs_balanced', 'sale_lines', 'sale_payments', 'ledger_sales_vat', 'cogs', 'refund_limits', 'stock_movements', 'inventory_value', 'receivables', 'payables', 'shift_cash', 'cash_sources', 'cash_flow', 'orphans', 'duplicates', 'audit_chain', 'backup_records']));

  it('finds a one-sided journal line', () => {
    unlock('journal_lines');
    ctx.db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 1, 0)').run(firstEntry('sale').id, accountId('1010'));
    expect(found()).toEqual(expect.arrayContaining(['je_balanced', 'tb_balanced', 'bs_balanced']));
  });

  it('finds a sale whose lines do not add up', () => {
    unlock('sale_lines');
    ctx.db.prepare('UPDATE sale_lines SET line_incl = line_incl + 100, line_excl = line_excl + 100 WHERE rowid = (SELECT MIN(rowid) FROM sale_lines)').run();
    expect(found()).toContain('sale_lines');
  });

  it('finds a sale with a payment gone', () => {
    unlock('payments');
    ctx.db.prepare('DELETE FROM payments WHERE id = (SELECT MIN(id) FROM payments)').run();
    expect(found()).toContain('sale_payments');
  });

  it('finds VAT in the books that differs from the sale', () => {
    shift(firstEntry('sale').id, '2200', '2900', 50, 'credit');
    expect(found()).toContain('ledger_sales_vat');
  });

  it('finds cost of goods that differs from the sale lines', () => {
    shift(firstEntry('sale').id, '5000', '1200', 500, 'debit');
    expect(found()).toContain('cogs');
  });

  it('finds refund cost of goods that differs from the restocked lines', () => {
    unlock('journal_lines');
    const entry = firstEntry('refund').id;
    ctx.db.prepare('UPDATE journal_lines SET credit = credit + 500 WHERE entry_id = ? AND account_id = ?').run(entry, accountId('5000'));
    ctx.db.prepare('UPDATE journal_lines SET debit = debit + 500 WHERE entry_id = ? AND account_id = ?').run(entry, accountId('1200'));
    expect(found()).toContain('cogs');
  });

  for (const [source, table] of [['expense_amort', 'expense_amortization'], ['expense_reversal', 'expenses'], ['customer_advance_applied', 'receipt_allocations'], ['supplier_advance_applied', 'supplier_payment_allocations']] as const) {
    it(`finds a ${source} entry whose record is gone (${table})`, () => {
      unlock('journal_entries');
      ctx.db.pragma('foreign_keys = OFF');
      ctx.db.prepare("INSERT INTO journal_entries (entry_date, source_type, source_id, memo, created_at) VALUES ('2026-11-01', ?, 99999999, 'test', ?)").run(source, NOW);
      expect(found()).toContain('orphans');
    });
  }

  it('a journal entry from an unknown source is reported', () => {
    ctx.db.prepare("INSERT INTO journal_entries (entry_date, source_type, source_id, memo, created_at) VALUES ('2026-11-01', 'mystery', 1, 'test', ?)").run(NOW);
    expect(found()).toContain('orphans');
  });

  it('finds a refund for more than was sold', () => {
    unlock('refund_lines');
    ctx.db.prepare('UPDATE refund_lines SET qty = qty + 900000 WHERE rowid = (SELECT MIN(rowid) FROM refund_lines)').run();
    expect(found()).toContain('refund_limits');
  });

  it('finds a stock balance that differs from its movements', () => {
    ctx.db.prepare('UPDATE stock_balances SET qty = qty + 1000 WHERE product_id = (SELECT MIN(product_id) FROM stock_balances)').run();
    expect(found()).toContain('stock_movements');
  });

  it('finds inventory in the books that differs from stock at cost', () => {
    shift(firstEntry('sale').id, '1200', '2900', 5_000_000, 'debit');
    expect(found()).toContain('inventory_value');
  });

  it('finds customer debt in the books that differs from open invoices', () => {
    shift(firstEntry('sale').id, '1100', '2900', 1234, 'debit');
    expect(found()).toContain('receivables');
  });

  it('finds supplier debt in the books that differs from open items', () => {
    shift(firstEntry('sale').id, '2000', '2900', 1234, 'credit');
    expect(found()).toContain('payables');
  });

  it("finds a closed shift whose expected cash is wrong", () => {
    ctx.db.exec('DROP TRIGGER IF EXISTS trg_shift_closed_is_final');
    ctx.db.prepare("UPDATE register_shifts SET expected_cash = expected_cash + 500 WHERE id = (SELECT MIN(id) FROM register_shifts WHERE status = 'closed')").run();
    expect(found()).toContain('shift_cash');
  });

  it('finds cash in the books that differs from the documents', () => {
    shift(firstEntry('sale').id, '1010', '2900', 700, 'debit');
    expect(found()).toContain('cash_sources');
  });

  it('finds a cash flow report that does not tie to the books', () => {
    const report = cashFlowData(ctx, '2026-01-01', '2026-12-31');
    expect(checkCashFlow(ctx, report)).toEqual([]);
    expect(checkCashFlow(ctx, { ...report, net: report.net + 1 }).map((f) => f.checkId)).toEqual(['cash_flow']);
  });

  it('finds a journal entry whose document is gone', () => {
    unlock('journal_entries');
    ctx.db.pragma('foreign_keys = OFF');
    ctx.db.prepare('UPDATE journal_entries SET source_id = 99999999 WHERE id = ?').run(firstEntry('sale').id);
    expect(found()).toContain('orphans');
  });

  it('finds a payment whose sale is gone', () => {
    unlock('payments');
    ctx.db.pragma('foreign_keys = OFF');
    ctx.db.prepare('UPDATE payments SET sale_id = 99999999 WHERE id = (SELECT MIN(id) FROM payments)').run();
    expect(found()).toContain('orphans');
  });

  it('finds duplicate numbers', () => {
    ctx.db.exec("CREATE TEMP TABLE doc (no TEXT); INSERT INTO doc VALUES ('A'), ('A'), ('B');");
    expect(duplicatesIn(ctx, 'doc', 'no').map((f) => f.entityId)).toEqual(['A']);
  });

  it('finds a changed audit row', () => {
    unlock('audit_log');
    ctx.db.prepare("UPDATE audit_log SET details_json = '{}' WHERE id = (SELECT MIN(id) FROM audit_log)").run();
    expect(found()).toContain('audit_chain');
  });

  it('finds a backup record with details missing', () => {
    ctx.db.prepare("INSERT INTO backup_jobs (created_at, trigger, status) VALUES (?, 'manual', 'verified_local')").run(NOW);
    expect(found()).toContain('backup_records');
  });

  it('every finding explains itself', () => {
    unlock('sale_lines');
    ctx.db.prepare('UPDATE sale_lines SET line_incl = line_incl + 100, line_excl = line_excl + 100 WHERE rowid = (SELECT MIN(rowid) FROM sale_lines)').run();
    const f = runChecks(ctx).find((x) => x.checkId === 'sale_lines')!;
    expect(f).toMatchObject({ severity: 'critical', entityType: 'sale' });
    for (const text of [f.problem, f.explanation, f.suggestion, f.entityId]) expect(text.length).toBeGreaterThan(0);
  });
});

describe('rounding is not a fault', () => {
  it('average cost held to the halala is not flagged', () => {
    ctx.db.prepare('UPDATE stock_balances SET avg_cost = avg_cost').run();
    const units = (ctx.db.prepare('SELECT SUM(ABS(qty)) AS n FROM stock_balances').get() as { n: number }).n;
    expect(units).toBeGreaterThan(0);
    const small = Math.floor(units / 2000) - 1;
    shift(firstEntry('sale').id, '1200', '2900', small, 'debit');
    expect(found()).not.toContain('inventory_value');
  });
});
