import type { DaySnapshot } from '../shared/snapshots.ts';
import { divRound } from './money.ts';
import { addDays, daysBetween, monthStart, weekStart } from './period.ts';

// Adds up the POS's own daily figures. It works out no accounting of its own.
// A day the POS never sent is missing, not zero: with no days at all, every figure is null.

const ADDITIVE = ['salesInclVat', 'transactions', 'netSales', 'returns', 'discounts', 'cogs', 'grossProfit', 'operatingExpenses', 'netProfit', 'outputVat', 'inputVat', 'cash', 'card', 'onAccount', 'supplierCreditPurchases'] as const;
type Field = (typeof ADDITIVE)[number];

export type Totals = Record<Field, number | null> & { averageSale: number | null };

export interface Coverage {
  expected: number;
  received: number;
  missing: string[];
}

export interface Summary {
  totals: Totals;
  coverage: Coverage;
  expenses: { code: string; name: string; amount: number }[];
  byCategory: { name: string; net: number; qty: number }[];
  byProduct: { sku: string; name: string; qty: number; net: number }[];
}

export function summarise(days: DaySnapshot[], from: string, to: string): Summary {
  const wanted = daysBetween(from, to);
  const have = new Map(days.filter((d) => d.day >= from && d.day <= to).map((d) => [d.day, d]));
  const present = wanted.flatMap((d) => have.get(d) ?? []);
  const totals = Object.fromEntries(ADDITIVE.map((f) => [f, present.length ? present.reduce((s, d) => s + d[f], 0) : null])) as Record<Field, number | null>;

  const expenses = new Map<string, { code: string; name: string; amount: number }>();
  const byCategory = new Map<string, { name: string; net: number; qty: number }>();
  const byProduct = new Map<string, { sku: string; name: string; qty: number; net: number }>();
  for (const d of present) {
    for (const e of d.expenses) {
      const x = expenses.get(e.code) ?? { code: e.code, name: e.name, amount: 0 };
      x.amount += e.amount;
      expenses.set(e.code, x);
    }
    for (const c of d.byCategory) {
      const x = byCategory.get(c.name) ?? { name: c.name, net: 0, qty: 0 };
      x.net += c.net;
      x.qty += c.qty;
      byCategory.set(c.name, x);
    }
    for (const p of d.byProduct) {
      const x = byProduct.get(p.sku) ?? { sku: p.sku, name: p.name, qty: 0, net: 0 };
      x.net += p.net;
      x.qty += p.qty;
      byProduct.set(p.sku, x);
    }
  }
  return {
    totals: { ...totals, averageSale: totals.transactions ? divRound(totals.salesInclVat!, totals.transactions) : null },
    coverage: { expected: wanted.length, received: present.length, missing: wanted.filter((d) => !have.has(d)) },
    expenses: [...expenses.values()].sort((a, b) => b.amount - a.amount),
    byCategory: [...byCategory.values()].sort((a, b) => b.net - a.net),
    byProduct: [...byProduct.values()].sort((a, b) => b.net - a.net),
  };
}

export interface Point {
  key: string;
  value: number | null;
}

/** One point per day. A day the POS never sent stays null, so a chart can show the gap. */
export function dailySeries(days: DaySnapshot[], from: string, to: string, field: Field): Point[] {
  const have = new Map(days.map((d) => [d.day, d[field]]));
  return daysBetween(from, to).map((key) => ({ key, value: have.get(key) ?? null }));
}

/** One point per week or month over the days received. A bucket with no days at all stays null. */
export function bucketSeries(days: DaySnapshot[], from: string, to: string, field: Field, unit: 'week' | 'month'): Point[] {
  const start = unit === 'week' ? weekStart : monthStart;
  const sums = new Map<string, number>();
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    sums.set(start(d.day), (sums.get(start(d.day)) ?? 0) + d[field]);
  }
  const out: Point[] = [];
  for (let k = start(from); k <= to; k = unit === 'week' ? addDays(k, 7) : monthStart(addDays(k, 32))) out.push({ key: k, value: sums.get(k) ?? null });
  return out;
}
