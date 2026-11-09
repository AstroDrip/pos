import { describe, expect, it } from 'vitest';
import { axisBounds, indexAt, labelEvery, niceCeil, spanOf, stepIndex, tooltipLeft } from './chart';

describe('chart arithmetic', () => {
  it('between two points, the pointer snaps to a real one', () => {
    expect(indexAt(40, 40, 300, 10)).toBe(0);
    expect(indexAt(69, 40, 300, 10)).toBe(0);
    expect(indexAt(70, 40, 300, 10)).toBe(1);
    expect(indexAt(339, 40, 300, 10)).toBe(9);
  });

  it('outside the plot it stays on the first or last point, and no points gives none', () => {
    expect(indexAt(0, 40, 300, 10)).toBe(0);
    expect(indexAt(999, 40, 300, 10)).toBe(9);
    expect(indexAt(50, 40, 300, 0)).toBe(-1);
  });

  it('the axis is round, covers the data and ignores gaps', () => {
    expect(niceCeil(137)).toBe(200);
    expect(niceCeil(2_300)).toBe(2_500);
    expect(axisBounds([10, null, 90])).toEqual({ min: 0, max: 100 });
    expect(axisBounds([null, null])).toEqual({ min: 0, max: 100 });
    expect(axisBounds([-30, 90])).toEqual({ min: -50, max: 100 });
    expect(axisBounds([-30, -10])).toEqual({ min: -50, max: 0 });
  });

  it('labels thin out so they do not collide', () => {
    expect(labelEvery(5, 500)).toBe(1);
    expect(labelEvery(62, 520)).toBe(7);
  });

  it('a tooltip never leaves the chart', () => {
    expect(tooltipLeft(100, 200, 600)).toBe(112);
    expect(tooltipLeft(500, 200, 600)).toBe(288);
    expect(tooltipLeft(150, 200, 300)).toBeGreaterThanOrEqual(0);
    expect(tooltipLeft(150, 200, 300) + 200).toBeLessThanOrEqual(300);
  });

  it('a drag works in either direction, and keys stay inside', () => {
    expect(spanOf(7, 2)).toEqual([2, 7]);
    expect(stepIndex(-1, 1, 5)).toBe(0);
    expect(stepIndex(-1, -1, 5)).toBe(4);
    expect(stepIndex(4, 1, 5)).toBe(4);
    expect(stepIndex(0, -1, 5)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});
