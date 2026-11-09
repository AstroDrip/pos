import { describe, expect, it } from 'vitest';
import { MAX_SIGNAL_BOOST, MAX_TOTAL_BOOST, liftOf, rankScore } from './rank';
import { storeHourBlock, storeWeekday } from './store-time';

describe('ranking', () => {
  it('no pattern means no change', () => expect(rankScore({ history: 0.4, hourShare: null, dayShare: null })).toBe(0.4));

  it('a below-average time is not a penalty', () => expect(rankScore({ history: 0.4, hourShare: 0.01, dayShare: 0.01 })).toBe(0.4));

  it('one signal is capped', () => expect(rankScore({ history: 1, hourShare: 1, dayShare: null })).toBe(MAX_SIGNAL_BOOST));

  it('both signals together are capped', () => expect(rankScore({ history: 1, hourShare: 1, dayShare: 1 })).toBe(MAX_TOTAL_BOOST));

  it('no history stays at zero', () => expect(rankScore({ history: 0, hourShare: 1, dayShare: 1 })).toBe(0));

  it('lift compares a share with an even spread', () => {
    expect(liftOf(null, 6)).toBe(1);
    expect(liftOf(1 / 6, 6)).toBeCloseTo(1);
    expect(liftOf(1 / 3, 6)).toBeCloseTo(2);
  });
});

describe('store clock', () => {
  it('splits the Saudi day into six blocks', () => {
    expect(storeHourBlock('2026-11-08T20:30:00.000Z')).toBe(5); // 23:30 in the store
    expect(storeHourBlock('2026-11-08T21:10:00.000Z')).toBe(0); // 00:10 in the store
    expect(storeHourBlock('2026-11-09T05:00:00.000Z')).toBe(2); // 08:00 in the store
  });

  it('uses the Saudi weekday', () => {
    expect(storeWeekday('2026-11-08T20:30:00.000Z')).toBe(0); // still Sunday in the store
    expect(storeWeekday('2026-11-08T21:10:00.000Z')).toBe(1); // already Monday in the store
  });
});
