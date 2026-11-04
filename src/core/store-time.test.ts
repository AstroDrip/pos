import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { nextDay, sqlStoreDay, storeDay, storeDayStartUtc } from './store-time';

describe('Saudi business day', () => {
  it('evening UTC timestamps belong to the next Saudi day', () => {
    expect(storeDay('2026-11-05T20:59:59.999Z')).toBe('2026-11-05'); // 23:59:59 in Riyadh
    expect(storeDay('2026-11-05T21:00:00.000Z')).toBe('2026-11-06'); // 00:00 in Riyadh
  });
  it('day start and month/year rollover', () => {
    expect(storeDayStartUtc('2026-11-06')).toBe('2026-11-05T21:00:00.000Z');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(() => storeDayStartUtc('2026-13-01')).toThrow();
  });
  it('SQL expression agrees with the TypeScript function', () => {
    const db = new Database(':memory:');
    for (const ts of ['2026-11-05T20:59:59.999Z', '2026-11-05T21:00:00.000Z', '2026-12-31T22:00:00.000Z']) {
      expect((db.prepare(`SELECT ${sqlStoreDay('?')} AS d`).get(ts) as { d: string }).d).toBe(storeDay(ts));
    }
  });
});
