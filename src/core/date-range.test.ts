import { describe, expect, it } from 'vitest';
import { daysApart, longDay, pickDay, presetOf, presetRange, rangeText, shiftRange, stepDay, stripDays, validRange } from './date-range';

const T = '2026-11-10'; // a Tuesday

describe('date choices', () => {
  it('presets', () => {
    expect(presetRange('today', T)).toEqual({ from: T, to: T });
    expect(presetRange('yesterday', T)).toEqual({ from: '2026-11-09', to: '2026-11-09' });
    expect(presetRange('week', T)).toEqual({ from: '2026-11-08', to: T });
    expect(presetRange('month', T)).toEqual({ from: '2026-11-01', to: T });
    expect(presetRange('last_month', T)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('recognises a preset from its dates', () => {
    expect(presetOf({ from: '2026-11-01', to: T }, T)).toBe('month');
    expect(presetOf({ from: '2026-11-02', to: T }, T)).toBeNull();
  });

  it('moves a day, a stretch of days and a whole month', () => {
    expect(shiftRange({ from: '2026-11-05', to: '2026-11-05' }, -1, T)).toEqual({ from: '2026-11-04', to: '2026-11-04' });
    expect(shiftRange({ from: '2026-11-03', to: '2026-11-05' }, 1, T)).toEqual({ from: '2026-11-06', to: '2026-11-08' });
    expect(shiftRange({ from: '2026-10-01', to: '2026-10-31' }, -1, T)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(shiftRange({ from: '2026-10-01', to: '2026-10-31' }, 1, T)).toEqual({ from: '2026-11-01', to: T });
  });

  it('never goes past today', () => {
    expect(shiftRange({ from: T, to: T }, 1, T)).toEqual({ from: T, to: T });
    expect(shiftRange({ from: '2026-11-07', to: '2026-11-09' }, 1, T)).toEqual({ from: T, to: T });
    expect(stepDay({ from: T, to: T }, 1, T)).toEqual({ from: T, to: T });
    expect(stripDays({ from: T, to: T }, T).at(-1)).toBe(T);
  });

  it('the strip surrounds the selection', () => {
    const days = stripDays({ from: '2026-09-10', to: '2026-09-10' }, T, 5, 2);
    expect(days[0]).toBe('2026-09-05');
    expect(days.at(-1)).toBe('2026-09-12');
  });

  it('picking a day, and stretching with Shift both ways', () => {
    const r = { from: '2026-11-05', to: '2026-11-05' };
    expect(pickDay('2026-11-07', r, false)).toEqual({ from: '2026-11-07', to: '2026-11-07' });
    expect(pickDay('2026-11-07', r, true)).toEqual({ from: '2026-11-05', to: '2026-11-07' });
    expect(pickDay('2026-11-02', r, true)).toEqual({ from: '2026-11-02', to: '2026-11-05' });
  });

  it('labels and checks', () => {
    expect(longDay('2026-11-08')).toBe('8 Nov 2026');
    expect(rangeText({ from: '2026-11-01', to: '2026-11-08' })).toBe('1 Nov – 8 Nov 2026');
    expect(daysApart('2026-11-01', '2026-11-08')).toBe(7);
    expect(validRange({ from: '2026-11-01', to: '2026-11-08' })).toBe(true);
    expect(validRange({ from: '2026-11-09', to: '2026-11-08' })).toBe(false);
    expect(validRange(null)).toBe(false);
  });
});
