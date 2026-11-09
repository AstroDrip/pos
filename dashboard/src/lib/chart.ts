// Which real bar a finger or pointer is on, and where its label goes. Nothing is interpolated.

export function indexAt(x: number, plotLeft: number, plotWidth: number, count: number): number {
  if (count === 0) return -1;
  const i = Math.floor(((x - plotLeft) * count) / plotWidth);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

/** The left edge of a readout centred on a point, kept inside the chart. */
export function readoutLeft(anchor: number, width: number, chartWidth: number): number {
  const left = anchor - width / 2;
  return left < 0 ? 0 : left + width > chartWidth ? Math.max(0, chartWidth - width) : left;
}
