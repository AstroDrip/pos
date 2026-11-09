// The arithmetic of the one chart component: which real point is under the pointer, and where things are drawn.
// It never works out business figures. A point the pointer is near snaps to a real record, and nothing is interpolated.

/** The band under a position. Always a real index, or -1 when there are no points. */
export function indexAt(x: number, plotLeft: number, plotWidth: number, count: number): number {
  if (count === 0) return -1;
  const i = Math.floor(((x - plotLeft) * count) / plotWidth);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

/** A round number at or above v, for the top of the axis. */
export function niceCeil(v: number): number {
  if (v <= 0) return 0;
  let step = 1;
  while (step * 10 <= v) step *= 10;
  for (const m of [1, 2, 2.5, 5, 10]) if (step * m >= v) return step * m;
  return step * 10;
}

export function axisBounds(values: readonly (number | null)[]): { min: number; max: number } {
  const known = values.filter((v): v is number => v !== null);
  const hi = Math.max(0, ...known);
  const lo = Math.min(0, ...known);
  return { max: hi > 0 ? niceCeil(hi) : lo < 0 ? 0 : 100, min: lo < 0 ? -niceCeil(-lo) : 0 };
}

/** How far apart axis labels go so they do not run into each other: label every nth point. */
export const labelEvery = (count: number, plotWidth: number, labelWidth = 52): number => {
  const fit = Math.floor(plotWidth / labelWidth);
  return fit <= 0 ? count : Math.max(1, Math.ceil(count / fit));
};

/** Where to put a tooltip so it stays inside the chart: beside the point, on the side with room. */
export function tooltipLeft(anchor: number, tipWidth: number, chartWidth: number, gap = 12): number {
  const right = anchor + gap;
  if (right + tipWidth <= chartWidth) return right;
  const left = anchor - gap - tipWidth;
  return left >= 0 ? left : Math.max(0, chartWidth - tipWidth);
}

/** The inclusive span between two points in any order. */
export const spanOf = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** A keyboard step from the current point, kept inside the chart. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  const start = current < 0 ? (delta > 0 ? -1 : count) : current;
  const n = start + delta;
  return n < 0 ? 0 : n >= count ? count - 1 : n;
}
