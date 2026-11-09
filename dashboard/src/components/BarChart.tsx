import { formatSar, formatSarShort } from '@/lib/money';
import type { Point } from '@/lib/summary';
import { BarChartClient } from './BarChartClient';

function niceMax(v: number): number {
  if (v <= 0) return 100;
  let step = 100;
  while (step * 10 <= v) step *= 10;
  for (const m of [1, 2, 5, 10]) if (step * m >= v) return step * m;
  return step * 10;
}

/** Works out the labels on the server, and hands plain values to the interactive part. A period with no data is never drawn as zero. */
export function BarChart({ title, unit, points, label }: { title: string; unit: string; points: Point[]; label: (key: string) => string }) {
  const known = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  if (known.length === 0) return <p className="empty">No figures received for this period.</p>;
  const top = niceMax(Math.max(0, ...known));
  const bottom = Math.min(0, ...known) < 0 ? -niceMax(-Math.min(...known)) : 0;
  const ticks = (bottom < 0 ? [top, 0, bottom] : [top, top / 2, 0]).map((value) => ({ value, text: formatSarShort(value) }));
  return <BarChartClient title={title} unit={unit} top={top} bottom={bottom} ticks={ticks} points={points.map((p) => ({ key: p.key, label: label(p.key), amount: formatSar(p.value), value: p.value }))} />;
}
