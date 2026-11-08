import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeDay } from '../core/store-time';
import { verifyAuditChain } from '../services/audit';
import type { Ctx } from '../services/context';
import { creditControls, listCustomerAccounts, receivablesAgeing } from '../services/credit';
import { balanceSheet, profitAndLoss } from '../services/financials';
import { stockDrift } from '../services/inventory';
import { trialBalance, unbalancedEntries } from '../services/ledger';
import { uninvoicedGrns } from '../services/purchasing';
import { recentSales } from '../services/refunds';
import { adjustmentsReport, refundsReport, salesSummary, stockOnHand, voidsReport } from '../services/reports';
import { listShifts } from '../services/shifts';
import { makeTestCtx } from '../services/test-helpers';
import { seedDemoShop, type DemoSummary } from './seed';

const NOW = '2026-11-08T14:30:00.000Z';
let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let shop: DemoSummary;
const count = (table: string, where = '1=1') => (ctx.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

beforeAll(() => {
  t = makeTestCtx();
  ctx = { ...t.ctx, now: () => NOW };
  shop = seedDemoShop(ctx, NOW);
}, 120_000);
afterAll(() => t.cleanup());

describe('demo shop', () => {
  it('covers at least a week and a half, up to today', () => {
    const days = (ctx.db.prepare('SELECT DISTINCT created_at AS at FROM sales').all() as { at: string }[]).map((r) => storeDay(r.at));
    const unique = [...new Set(days)].sort();
    expect(unique.length).toBeGreaterThanOrEqual(11);
    expect(unique.at(-1)).toBe(storeDay(NOW));
    expect(Date.parse(storeDay(NOW)) - Date.parse(unique[0]!)).toBeGreaterThanOrEqual(10 * 86_400_000);
  });

  it('never dates anything after now', () => {
    const latest = (ctx.db.prepare('SELECT MAX(created_at) AS at FROM sales').get() as { at: string }).at;
    expect(Date.parse(latest)).toBeLessThanOrEqual(Date.parse(NOW));
  });

  it('has data for every part of the shop', () => {
    expect(count('sales')).toBeGreaterThanOrEqual(400);
    expect(count('products')).toBeGreaterThanOrEqual(60);
    expect(count('products', 'active = 0')).toBeGreaterThan(0);
    expect(count('customers')).toBeGreaterThanOrEqual(25);
    expect(count('suppliers')).toBeGreaterThanOrEqual(6);
    expect(count('users')).toBeGreaterThanOrEqual(4);
    expect(count('refunds')).toBeGreaterThan(5);
    expect(count('held_bills')).toBeGreaterThan(0);
    expect(count('supplier_bills')).toBeGreaterThan(10);
    expect(count('supplier_bills', "doc_type = 'delivery_note'")).toBeGreaterThan(0);
    expect(count('purchase_invoices')).toBeGreaterThan(5);
    expect(count('supplier_payments')).toBeGreaterThan(0);
    expect(count('purchase_returns')).toBeGreaterThan(0);
    expect(count('expenses')).toBeGreaterThan(10);
    expect(count('customer_receipts')).toBeGreaterThan(3);
    expect(count('stock_adjustments')).toBeGreaterThan(2);
    expect(count('cash_movements')).toBeGreaterThan(2);
    expect(shop.sales).toBe(count('sales'));
  });

  it('has every way of paying', () => {
    for (const tender of ['cash', 'card', 'account']) expect(count('payments', `tender = '${tender}'`), tender).toBeGreaterThan(5);
  });

  it('has one closed shift per past day, some with a cash difference, and today open', () => {
    const rows = listShifts(ctx, shop.owner, 60);
    expect(rows.filter((r) => r.status === 'closed').length).toBeGreaterThanOrEqual(12);
    expect(rows.filter((r) => r.status === 'open').length).toBe(1);
    expect(rows.filter((r) => (r.difference ?? 0) !== 0).length).toBeGreaterThan(0);
  });

  it('adds up: accounts, stock and audit trail', () => {
    expect(unbalancedEntries(ctx)).toEqual([]);
    const tb = trialBalance(ctx);
    expect(tb.reduce((s, r) => s + r.debit, 0)).toBe(tb.reduce((s, r) => s + r.credit, 0));
    expect(stockDrift(ctx)).toEqual([]);
    expect(verifyAuditChain(ctx)).toBeNull();
    expect(creditControls(ctx).ok).toBe(true);
    expect(count('stock_balances', 'qty < 0')).toBe(0);
  });

  it('fills the accounts screens', () => {
    const day = storeDay(NOW);
    const bs = balanceSheet(ctx, shop.owner, day) as unknown as Record<string, unknown>;
    expect(JSON.stringify(bs).length).toBeGreaterThan(50);
    const pnl = profitAndLoss(ctx, shop.owner, '2026-10-01', day);
    expect(JSON.stringify(pnl).length).toBeGreaterThan(50);
    expect(receivablesAgeing(ctx, shop.owner).length).toBeGreaterThan(0);
  });

  it('has some customers who owe, and some overdue', () => {
    expect(listCustomerAccounts(ctx, shop.owner, { offset: 0, limit: 100 }).items.filter((c) => c.outstanding > 0).length).toBeGreaterThan(2);
    expect(JSON.stringify(receivablesAgeing(ctx, shop.owner))).toMatch(/[1-9]/);
  });

  it('fills the empty-search lists and the reports for today', () => {
    const day = storeDay(NOW);
    expect(recentSales(ctx, shop.owner, { offset: 0, limit: 10 }).items.length).toBe(10);
    expect(stockOnHand(ctx, shop.owner, false).length).toBeGreaterThanOrEqual(55);
    expect(stockOnHand(ctx, shop.owner, true).length).toBeGreaterThan(0);
    expect(salesSummary(ctx, shop.owner, day, day).saleCount).toBeGreaterThan(0);
    expect(refundsReport(ctx, shop.owner, day, day).length).toBeGreaterThan(0);
    expect(voidsReport(ctx, shop.owner, day, day).length).toBeGreaterThan(0);
    expect(adjustmentsReport(ctx, shop.owner, day, day).length).toBeGreaterThan(0);
    expect(uninvoicedGrns(ctx, shop.owner).length).toBeGreaterThan(0);
  });

  it('is a made-up shop', () => {
    expect((ctx.db.prepare("SELECT value FROM settings WHERE key = 'store_name_en'").get() as { value: string }).value).toBe('Demo Supermarket');
  });
});

describe('demo shop just after midnight', () => {
  it('still works when today has only started', () => {
    const early = makeTestCtx();
    const now = '2026-11-08T21:02:00.000Z'; // 00:02 store time
    try {
      seedDemoShop({ ...early.ctx, now: () => now }, now, { days: 2 });
      expect((early.ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBeGreaterThan(0);
    } finally {
      early.cleanup();
    }
  }, 60_000);
});
