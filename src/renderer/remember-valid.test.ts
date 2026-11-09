import { describe, expect, it } from 'vitest';
import { validDay, validId, validOneOf, validText } from './remember';

describe('checks on remembered values', () => {
  it('accepts a real day and refuses anything else', () => {
    expect(validDay('2026-11-09')).toBe(true);
    for (const v of ['2026-13-40', '09/11/2026', '', 20261109, null]) expect(validDay(v), String(v)).toBe(false);
  });

  it('a tab the user cannot open is refused', () => {
    const can = validOneOf(['sell', 'shift']);
    expect(can('sell')).toBe(true);
    expect(can('admin')).toBe(false);
    expect(can(3)).toBe(false);
  });

  it('ids are whole numbers above zero, or null for none', () => {
    expect(validId(5)).toBe(true);
    expect(validId(null)).toBe(true);
    for (const v of [0, -1, 1.5, '5']) expect(validId(v), String(v)).toBe(false);
  });

  it('text has a sensible length', () => {
    expect(validText('milk')).toBe(true);
    expect(validText('x'.repeat(201))).toBe(false);
    expect(validText(5)).toBe(false);
  });
});
