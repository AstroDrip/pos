import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarise } from '../src/lib/summary.ts';
import { DEMO_STORE_ID, demoSeedStatements, type DemoFile } from '../src/server/demo-seed-core.ts';
import { syncEvent, type DaySnapshot, type PositionSnapshot } from '../src/shared/snapshots.ts';
import { makeCloud, type TestCloud } from './helpers.ts';

// This file comes from the real POS services (scripts/export-demo-snapshots.cjs), so this also proves the two sides agree.
const file = JSON.parse(readFileSync(join(__dirname, '..', 'seed', 'demo-snapshots.json'), 'utf8')) as DemoFile;
let c: TestCloud;

beforeAll(async () => {
  c = await makeCloud();
  await c.owner.batch(demoSeedStatements(file, 'scrypt$hash-not-used'));
});
afterAll(() => c.pg.close());

describe('the demo data', () => {
  it('every record passes the same check as a real till upload', () => {
    for (const e of file.events) {
      const r = syncEvent.safeParse({ ...e, eventId: '00000000-0000-4000-8000-000000000001', version: 1, createdAt: file.generatedAt });
      expect([e.kind, e.snapKey, r.success ? 'ok' : JSON.stringify(r.error.issues.slice(0, 3))]).toEqual([e.kind, e.snapKey, 'ok']);
    }
  });

  it('has about two months of days and every other kind', () => {
    const kinds = file.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'day').length).toBeGreaterThanOrEqual(60);
    for (const k of ['position', 'stock', 'credit', 'shift']) expect(kinds).toContain(k);
  });

  it('adds up to the totals the POS worked out', () => {
    const days = file.events.filter((e) => e.kind === 'day').map((e) => e.payload as DaySnapshot);
    const r = (file.events.find((e) => e.kind === 'position')!.payload as PositionSnapshot).reconcile;
    const s = summarise(days, r.fromDay, r.toDay);
    expect(s.coverage.missing).toEqual([]);
    expect(s.totals.salesInclVat).toBe(r.salesInclVat);
    expect(s.totals.transactions).toBe(r.transactions);
    expect(s.totals.netProfit).toBe(r.netProfit);
    expect(s.totals.salesInclVat).toBeGreaterThan(0);
  });

  it('lands in the demo schema only', async () => {
    expect(Number((await c.owner.query<{ n: string }>('SELECT count(*) AS n FROM demo.snapshots'))[0]!.n)).toBe(file.events.length);
    expect(Number((await c.owner.query<{ n: string }>('SELECT count(*) AS n FROM readmodel.snapshots'))[0]!.n)).toBe(0);
    for (const s of demoSeedStatements(file, 'x')) expect(s.text).not.toMatch(/readmodel|cloud\.|backup\./);
  });

  it('holds only the made-up shop', () => {
    expect(file.storeName).toMatch(/demo/i);
    expect(DEMO_STORE_ID).toMatch(/^00000000/);
    expect(JSON.stringify(file)).not.toMatch(/Joori/i);
  });

  it('can be read by the demo role and not the real one', async () => {
    expect((await c.demo.query('SELECT 1 FROM demo.snapshots LIMIT 1'))).toHaveLength(1);
    await expect(c.app.query('SELECT 1 FROM demo.snapshots LIMIT 1')).rejects.toThrow(/permission denied/);
  });
});
