'use client';

import { useState } from 'react';
import { indexAt, readoutLeft } from '@/lib/chart';

export interface ClientPoint {
  key: string;
  label: string;
  amount: string;
  value: number | null;
}

const W = 360;
const H = 170;
const LEFT = 40;
const RIGHT = 6;
const TOP = 8;
const BOTTOM = 22;
const READOUT = 150;

/** Tap a bar to read it, or drag along the chart to move through the bars. A mouse works the same way on hover. */
export function BarChartClient({ title, unit, points, ticks, top, bottom }: { title: string; unit: string; points: ClientPoint[]; ticks: { value: number; text: string }[]; top: number; bottom: number }) {
  const [active, setActive] = useState(-1);
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const y = (v: number) => TOP + ((top - v) * plotH) / (top - bottom);
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(26, slot - 2));
  const every = Math.max(1, Math.ceil(points.length / 5));
  const zero = y(0);
  const cx = (i: number) => LEFT + slot * i + slot / 2;
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActive(indexAt(((e.clientX - r.left) * W) / r.width, LEFT, plotW, points.length));
  };
  const current = active >= 0 && active < points.length ? points[active]! : null;
  const hasGaps = points.some((p) => p.value === null);
  return (
    <div className="chart">
      <div className="chart-read" aria-live="polite">
        {current ? <span style={{ marginInlineStart: `${(readoutLeft(cx(active), READOUT, W) * 100) / W}%`, width: `${(READOUT * 100) / W}%` }}><b>{current.amount}</b> {current.label}</span> : <span className="hint">Tap a bar to read it</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, in ${unit}. The table below has every value.`} onPointerDown={at} onPointerMove={at} style={{ touchAction: 'pan-y' }}>
        {ticks.map((t) => (
          <g key={t.value}>
            <line className="grid-line" x1={LEFT} x2={W - RIGHT} y1={y(t.value)} y2={y(t.value)} />
            <text className="axis" x={LEFT - 5} y={y(t.value) + 4} textAnchor="end">{t.text}</text>
          </g>
        ))}
        {current && <line className="cross" x1={cx(active)} x2={cx(active)} y1={TOP} y2={TOP + plotH} />}
        {points.map((p, i) => {
          const x = cx(i) - barW / 2;
          const yv = p.value === null ? zero : y(p.value);
          return (
            <g key={p.key}>
              {p.value === null ? <rect className="gap" x={x} y={zero - 3} width={barW} height={3} /> : p.value !== 0 ? <rect className={`bar${i === active ? ' on' : ''}`} x={x} y={Math.min(yv, zero)} width={barW} height={Math.max(1, Math.abs(zero - yv))} rx={3} /> : null}
              {i % every === 0 && <text className="axis" x={cx(i)} y={H - 6} textAnchor="middle">{p.label}</text>}
            </g>
          );
        })}
      </svg>
      <p className="legend">{unit}{hasGaps ? ' · Faint marks: no figures received' : ''}</p>
      <details>
        <summary>Show the numbers</summary>
        <table className="tbl">
          <thead><tr><th scope="col">Period</th><th scope="col">Amount</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.key}><td>{p.label}</td><td>{p.amount}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
