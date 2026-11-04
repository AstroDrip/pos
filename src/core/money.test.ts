import { describe, expect, it } from 'vitest';
import { extendPrice, formatQty, formatSar, parseQty, parseSar, roundDiv } from './money';

describe('roundDiv', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(1, 3)).toBe(0);
    expect(roundDiv(2, 3)).toBe(1);
  });
  it('rejects non-integers and unsafe values', () => {
    expect(() => roundDiv(1.5, 2)).toThrow(RangeError);
    expect(() => roundDiv(2 ** 53, 2)).toThrow(RangeError);
    expect(() => roundDiv(1, 0)).toThrow(RangeError);
  });
});

describe('extendPrice', () => {
  it('prices weighed items to the halala', () => {
    // 1.235 kg at SAR 7.99/kg = 9.86765 -> 9.87
    expect(extendPrice(799, 1235)).toBe(987);
    // 0.5 kg at SAR 0.01/kg = 0.005 -> rounds up to 0.01
    expect(extendPrice(1, 500)).toBe(1);
    // 3 pieces at SAR 2.50
    expect(extendPrice(250, 3000)).toBe(750);
  });
  it('avoids the classic float error 0.1 + 0.2', () => {
    expect(extendPrice(10, 1000) + extendPrice(20, 1000)).toBe(30);
  });
});

describe('parse/format', () => {
  it('round-trips SAR', () => {
    expect(parseSar('12.5')).toBe(1250);
    expect(parseSar('0.05')).toBe(5);
    expect(parseSar('-3')).toBe(-300);
    expect(formatSar(1250)).toBe('12.50');
    expect(formatSar(-5)).toBe('-0.05');
    expect(() => parseSar('1.234')).toThrow();
    expect(() => parseSar('abc')).toThrow();
  });
  it('round-trips quantities', () => {
    expect(parseQty('1.25')).toBe(1250);
    expect(parseQty('3')).toBe(3000);
    expect(formatQty(1250)).toBe('1.250');
    expect(formatQty(3000, 0)).toBe('3');
    expect(() => parseQty('1.2345')).toThrow();
  });
});
