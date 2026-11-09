import { formatSar, formatSarShort } from '@/lib/money';
import type { Point } from '@/lib/summary';

const W = 360;
const H = 170;
const LEFT = 40;
const RIGHT = 6;
const TOP = 8;
const BOTTOM = 22;

function niceMax(v: number): number {
  if (v <= 0) return 100;
  let step = 100;
  while (step * 10 <= v) step *= 10;
  for (const m of [1, 2, 5, 10]) if (step * m >= v) return step * m;
  return step * 10;
}

/** One series, so one colour and no legend box. A period with no data draws a faint stub and is never drawn as zero. */
export function BarChart({ title, unit, points, label }: { title: string; unit: string; points: Point[]; label: (key: string) => string }) {
  const known = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const hasGaps = known.length < points.length;
  if (known.length === 0) return <p className="empty">No figures received for this period.</p>;
  const top = niceMax(Math.max(0, ...known));
  const bottom = Math.min(0, ...known) < 0 ? -niceMax(-Math.min(...known)) : 0;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const y = (v: number) => TOP + ((top - v) * plotH) / (top - bottom);
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(26, slot - 2));
  const ticks = bottom < 0 ? [top, 0, bottom] : [top, top / 2, 0];
  const every = Math.max(1, Math.ceil(points.length / 5));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, in ${unit}. The table below has every value.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} />
            <text className="axis" x={LEFT - 5} y={y(t) + 4} textAnchor="end">{formatSarShort(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = LEFT + i * slot + (slot - barW) / 2;
          const showLabel = i % every === 0;
          const zero = y(0);
          return (
            <g key={p.key}>
              <title>{`${label(p.key)}: ${p.value === null ? 'Not available' : formatSar(p.value)}`}</title>
              <rect className="hit" x={LEFT + i * slot} y={TOP} width={slot} height={plotH} />
              {p.value === null ? (
                <rect className="gap" x={x} y={zero - 3} width={barW} height={3} />
              ) : p.value !== 0 ? (
                <path className="bar" d={barPath(x, barW, zero, y(p.value))} />
              ) : null}
              {showLabel && <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">{label(p.key)}</text>}
            </g>
          );
        })}
      </svg>
      <p className="legend">{unit}{hasGaps ? ' · Faint marks: no figures received' : ''}</p>
      <details>
        <summary>Show the numbers</summary>
        <table className="tbl">
          <thead><tr><th scope="col">Period</th><th scope="col">Amount</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.key}><td>{label(p.key)}</td><td>{formatSar(p.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** A bar anchored flat on the baseline, with its free end rounded. */
function barPath(x: number, w: number, base: number, end: number): string {
  const up = end < base;
  const r = Math.min(4, w / 2, Math.abs(base - end));
  const s = up ? 1 : -1;
  return `M${x} ${base}V${end + s * r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end + s * r}V${base}Z`;
}
