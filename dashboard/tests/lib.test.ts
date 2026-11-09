import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshness } from '../src/lib/freshness.ts';
import { divRound, formatCount, formatQty, formatSar, formatSarShort, percentChange } from '../src/lib/money.ts';
import { parsePeriod, riyadhToday, weekStart } from '../src/lib/period.ts';
import { bucketSeries, dailySeries, summarise } from '../src/lib/summary.ts';
import { readEnv } from '../src/server/env.ts';
import type { DaySnapshot } from '../src/shared/snapshots.ts';

const day = (d: string, o: Partial<DaySnapshot> = {}): DaySnapshot => ({ day: d, salesInclVat: 0, transactions: 0, netSales: 0, returns: 0, discounts: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, netProfit: 0, outputVat: 0, inputVat: 0, cash: 0, card: 0, onAccount: 0, supplierCreditPurchases: 0, expenses: [], byCategory: [], byProduct: [], provisional: true, ...o });

describe('money', () => {
  it('formats SAR exactly', () => {
    expect(formatSar(123_456_78)).toBe('SAR 123,456.78');
    expect(formatSar(5)).toBe('SAR 0.05');
    expect(formatSar(-1_234_50)).toBe('−SAR 1,234.50');
  });
  it('a real zero is zero, and missing is Not available', () => {
    expect(formatSar(0)).toBe('SAR 0.00');
    expect(formatSar(null)).toBe('Not available');
    expect(formatSar(undefined)).toBe('Not available');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('Not available');
  });
  it('quantity drops only trailing zeros', () => {
    expect(formatQty(1_500)).toBe('1.5');
    expect(formatQty(2_000)).toBe('2');
    expect(formatQty(1_005)).toBe('1.005');
  });
  it('short and percent forms', () => {
    expect(formatSarShort(1_250_000)).toBe('12K');
    expect(formatSarShort(350_000)).toBe('3.5K');
    expect(divRound(5, 2)).toBe(3);
    expect(percentChange(110, 100)).toBe('+10.0%');
    expect(percentChange(90, 100)).toBe('−10.0%');
    expect(percentChange(90, 0)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
  });
});

describe('periods in Saudi time', () => {
  it('a UTC time after 21:00 is already the next Saudi day', () => {
    expect(riyadhToday(new Date('2026-11-05T20:59:00Z'))).toBe('2026-11-05');
    expect(riyadhToday(new Date('2026-11-05T21:00:00Z'))).toBe('2026-11-06');
  });
  it('week starts on Sunday', () => expect(weekStart('2026-11-05')).toBe('2026-11-01'));
  it('this month compares with the same days last month', () => {
    expect(parsePeriod({}, '2026-11-05')).toMatchObject({ key: 'month', from: '2026-11-01', to: '2026-11-05', prevFrom: '2026-10-01', prevTo: '2026-10-05' });
  });
  it('last month is whole, even across a year', () => {
    expect(parsePeriod({ p: 'last_month' }, '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31', prevFrom: '2025-11-01', prevTo: '2025-11-30' });
  });
  it('a bad value falls back safely', () => {
    for (const bad of [{ p: "x'; DROP" }, { p: 'custom', from: 'nope', to: '2026-01-01' }, { p: 'custom', from: '2026-02-30', to: '2026-03-01' }, { p: 'custom', from: '2026-03-01', to: '2026-02-01' }, { p: 'custom', from: '2020-01-01', to: '2026-01-01' }, { p: 'custom', from: '2026-01-01', to: '2099-01-01' }]) {
      expect(parsePeriod(bad, '2026-11-05').key).toBe('month');
    }
  });
  it('a good custom range is kept and compared with the days before it', () => {
    expect(parsePeriod({ p: 'custom', from: '2026-10-11', to: '2026-10-20' }, '2026-11-05')).toMatchObject({ key: 'custom', prevFrom: '2026-10-01', prevTo: '2026-10-10' });
  });
});

describe('adding up days', () => {
  it('sums figures and merges breakdowns', () => {
    const s = summarise([
      day('2026-11-01', { salesInclVat: 1_000, transactions: 2, expenses: [{ code: '6100', name: 'Rent', amount: 50 }], byProduct: [{ sku: 'A', name: 'A', qty: 1_000, net: 10 }] }),
      day('2026-11-02', { salesInclVat: 500, transactions: 1, expenses: [{ code: '6100', name: 'Rent', amount: 25 }], byProduct: [{ sku: 'A', name: 'A', qty: 2_000, net: 20 }] }),
    ], '2026-11-01', '2026-11-02');
    expect(s.totals.salesInclVat).toBe(1_500);
    expect(s.totals.averageSale).toBe(500);
    expect(s.expenses).toEqual([{ code: '6100', name: 'Rent', amount: 75 }]);
    expect(s.byProduct).toEqual([{ sku: 'A', name: 'A', qty: 3_000, net: 30 }]);
  });

  it('no days received: every figure is missing, not zero', () => {
    const s = summarise([], '2026-11-01', '2026-11-03');
    expect(s.totals.salesInclVat).toBeNull();
    expect(s.totals.netProfit).toBeNull();
    expect(s.coverage).toEqual({ expected: 3, received: 0, missing: ['2026-11-01', '2026-11-02', '2026-11-03'] });
  });

  it('a day with no sales that the till did report is a real zero', () => {
    const s = summarise([day('2026-11-01')], '2026-11-01', '2026-11-01');
    expect(s.totals.salesInclVat).toBe(0);
    expect(s.totals.averageSale).toBeNull(); // no sales, so no average
    expect(s.coverage.missing).toEqual([]);
  });

  it('a missing day is reported, and stays null in a chart', () => {
    const days = [day('2026-11-01', { salesInclVat: 9 }), day('2026-11-03', { salesInclVat: 7 })];
    expect(summarise(days, '2026-11-01', '2026-11-03').coverage).toMatchObject({ received: 2, missing: ['2026-11-02'] });
    expect(dailySeries(days, '2026-11-01', '2026-11-03', 'salesInclVat').map((p) => p.value)).toEqual([9, null, 7]);
  });

  it('months and weeks group correctly, and an empty month is null', () => {
    const days = [day('2026-09-15', { netProfit: 4 }), day('2026-11-01', { netProfit: 5 }), day('2026-11-02', { netProfit: 6 })];
    expect(bucketSeries(days, '2026-09-01', '2026-11-30', 'netProfit', 'month')).toEqual([{ key: '2026-09-01', value: 4 }, { key: '2026-10-01', value: null }, { key: '2026-11-01', value: 11 }]);
    expect(bucketSeries(days, '2026-11-01', '2026-11-07', 'netProfit', 'week')).toEqual([{ key: '2026-11-01', value: 11 }]);
  });
});

describe('freshness', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('tells apart live, delayed, offline, never and demo', () => {
    expect(freshness('2026-11-05T11:50:00Z', now, false)).toBe('live');
    expect(freshness('2026-11-05T10:00:00Z', now, false)).toBe('delayed');
    expect(freshness('2026-11-04T10:00:00Z', now, false)).toBe('offline');
    expect(freshness(null, now, false)).toBe('never');
    expect(freshness('2020-01-01T00:00:00Z', now, true)).toBe('demo');
  });
});

describe('settings', () => {
  const real = 'postgresql://dashboard_app:x@h-pooler/db';
  const demo = 'postgresql://dashboard_demo:x@h-pooler/db';
  it('turning demo mode off removes the demo database entirely', () => {
    expect(readEnv({ DASHBOARD_DATABASE_URL: real, DASHBOARD_DEMO_DATABASE_URL: demo, DASHBOARD_DEMO_MODE: 'false' })).toMatchObject({ demoMode: false, demoUrl: null, realUrl: real });
    expect(readEnv({ DASHBOARD_DATABASE_URL: real, DASHBOARD_DEMO_DATABASE_URL: demo })).toMatchObject({ demoMode: false, demoUrl: null });
  });
  it('demo mode without its database is an error, and it does not fall back to real', () => {
    expect(() => readEnv({ DASHBOARD_DATABASE_URL: real, DASHBOARD_DEMO_MODE: 'true' })).toThrow(/DASHBOARD_DEMO_DATABASE_URL/);
  });
  it('the owner connection is refused for every app setting', () => {
    const owner = 'postgresql://neondb_owner:x@h/db';
    expect(() => readEnv({ DASHBOARD_DATABASE_URL: owner })).toThrow(/dashboard_app/);
    expect(() => readEnv({ DEVICE_API_DATABASE_URL: owner })).toThrow(/device_api/);
    expect(() => readEnv({ DASHBOARD_DEMO_MODE: 'true', DASHBOARD_DEMO_DATABASE_URL: owner })).toThrow(/dashboard_demo/);
  });
  it('a bad connection string names the setting and hides the value', () => {
    expect(() => readEnv({ DASHBOARD_DATABASE_URL: 'secret-not-a-url' })).toThrow(/DASHBOARD_DATABASE_URL/);
    expect(() => readEnv({ DASHBOARD_DATABASE_URL: 'secret-not-a-url' })).not.toThrow(/secret-not/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('nothing on the phone can write', () => {
  const root = join(__dirname, '..');
  const app = join(root, 'src', 'app');
  const files = walk(join(root, 'src'));

  it('the only route files are the health check and the device API', () => {
    for (const f of files.filter((x) => /[\\/]route\.ts$/.test(x))) expect(relative(app, f).replaceAll('\\', '/')).toMatch(/^api\/(health|device\/.+)\/route\.ts$/);
  });

  it('device routes all go through a guarded wrapper', () => {
    for (const f of files.filter((x) => /api[\\/]device.*route\.ts$/.test(x))) {
      const s = readFileSync(f, 'utf8');
      const open = /api[\\/]device[\\/](enroll|recover)[\\/]/.test(f);
      expect([relative(root, f), s.includes(open ? 'openRoute(' : 'deviceRoute(')]).toEqual([relative(root, f), true]);
    }
  });

  it('the only server actions are login and logout', () => {
    const actions = files.filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));
    expect(actions.map((f) => relative(root, f).replaceAll('\\', '/'))).toEqual(['src/app/actions.ts']);
    expect([...readFileSync(actions[0]!, 'utf8').matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(['loginAction', 'logoutAction']);
  });

  it('page code never writes to the database', () => {
    for (const f of files.filter((x) => x.includes(`${join('src', 'app')}`) && !x.includes('api'))) expect(readFileSync(f, 'utf8')).not.toMatch(/\b(INSERT INTO|UPDATE \w+\.|DELETE FROM)\b/);
    expect(readFileSync(join(root, 'src', 'server', 'data.ts'), 'utf8')).not.toMatch(/\b(INSERT INTO|UPDATE |DELETE FROM)\b/);
  });

  it('client components import nothing from the server', () => {
    for (const f of files.filter((x) => /^\s*['"]use client['"]/m.test(readFileSync(x, 'utf8')))) expect(readFileSync(f, 'utf8')).not.toMatch(/@\/server|process\.env/);
  });

  it('no setting is public', () => {
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/NEXT_PUBLIC_\w/);
  });

  it.skipIf(!existsSync(join(root, '.next', 'static')))('the built browser files hold no database detail', () => {
    for (const f of walk(join(root, '.next', 'static')).filter((x) => /\.(js|css|html|map)$/.test(x))) {
      const s = readFileSync(f, 'utf8');
      for (const banned of ['postgresql://', 'neon.tech', 'DASHBOARD_DATABASE_URL', 'DEVICE_API_DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'dashboard_app', 'device_api', 'password_hash']) expect([relative(root, f), banned, s.includes(banned)]).toEqual([relative(root, f), banned, false]);
    }
  });
});
