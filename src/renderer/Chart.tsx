import { useEffect, useRef, useState } from 'react';
import { axisBounds, indexAt, labelEvery, spanOf, stepIndex, tooltipLeft } from '../core/chart';
import { useI18n } from './i18n';
import { InfoIcon } from './InfoIcon';

export interface ChartSeries {
  name: string;
  format: (v: number) => string;
}

export interface ChartPoint {
  key: string;
  /** Under the axis. */
  axis: string;
  /** In the tooltip: the exact date and time. */
  title: string;
  /** One per series. null is a gap: nothing recorded, never drawn as zero. */
  values: (number | null)[];
  /** More facts for the tooltip. */
  extras?: { label: string; value: string }[];
}

const H = 220;
const LEFT = 62;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 26;
const TIP = 220;

/**
 * The one chart in the till. Hover, keyboard and touch all land on real points.
 * Click opens detail through `onPick`, and a drag chooses a range through `onRange`. Neither can change a record.
 */
export function Chart({ name, kind, series, points, axisFormat, onPick, onRange, info, emptyText }: {
  name: string;
  kind: 'bar' | 'line';
  series: ChartSeries[];
  points: ChartPoint[];
  axisFormat: (v: number) => string;
  onPick?: (p: ChartPoint) => void;
  onRange?: (from: ChartPoint, to: ChartPoint) => void;
  info?: string;
  emptyText?: string;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState(-1);
  const [drag, setDrag] = useState<{ start: number; now: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(-1);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setActive(-1), [points]);

  const all = points.flatMap((p) => p.values);
  if (points.length === 0 || all.every((v) => v === null)) return <p className="chart-empty">{emptyText ?? t('Nothing recorded for these dates.')}</p>;

  const plotW = Math.max(60, width - LEFT - RIGHT);
  const plotH = H - TOP - BOTTOM;
  const { min, max } = axisBounds(all);
  const y = (v: number) => TOP + ((max - v) * plotH) / (max - min || 1);
  const slot = plotW / points.length;
  const cx = (i: number) => LEFT + slot * i + slot / 2;
  const groupW = Math.max(3, Math.min(34, slot - 3));
  const barW = Math.max(2, groupW / series.length);
  const ticks = min < 0 ? [max, 0, min] : [max, max / 2, 0];
  const every = labelEvery(points.length, plotW);
  const zero = y(0);
  const here = (e: React.PointerEvent) => indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left, LEFT, plotW, points.length);
  const current = active >= 0 && active < points.length ? points[active]! : null;
  const span = drag && drag.start !== drag.now ? spanOf(drag.start, drag.now) : null;

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = here(e);
    moved.current = false;
    setActive(i);
    setDrag({ start: i, now: i });
  };
  const onMove = (e: React.PointerEvent) => {
    const i = here(e);
    setActive(i);
    if (drag && i !== drag.now) {
      moved.current = true;
      setDrag({ ...drag, now: i });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const i = here(e);
    const [a, b] = spanOf(drag.start, i);
    setDrag(null);
    if (moved.current && a !== b) onRange?.(points[a]!, points[b]!);
    // A finger has no hover: the first tap shows the figures, and a tap on the same point opens the detail.
    else if (e.pointerType !== 'touch' || drag.start === lastTap.current) onPick?.(points[i]!);
    lastTap.current = e.pointerType === 'touch' ? i : -1;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setActive(stepIndex(active, e.key === 'ArrowRight' ? 1 : -1, points.length));
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      e.stopPropagation();
      onPick?.(current);
    } else if (e.key === 'Escape' && active >= 0) {
      e.stopPropagation();
      setActive(-1);
    }
  };

  return (
    <div className="chart" ref={box}>
      {info && <div className="chart-info"><InfoIcon id={info} /></div>}
      <div className="chart-plot">
        <svg
          width={width} height={H} role="application" tabIndex={0} aria-label={`${name}. ${t('Arrow keys move between points. Enter opens the detail.')}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => !drag && setActive(-1)} onKeyDown={onKey} onFocus={() => setActive((a) => (a < 0 ? points.length - 1 : a))} onBlur={() => setActive(-1)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} />
              <text className="chart-axis" x={LEFT - 6} y={y(v) + 4} textAnchor="end">{axisFormat(v)}</text>
            </g>
          ))}
          {points.map((p, i) => (i % every === 0 ? <text key={p.key} className="chart-axis" x={cx(i)} y={H - 7} textAnchor="middle">{p.axis}</text> : null))}
          {span && <rect className="chart-span" x={LEFT + slot * span[0]} y={TOP} width={slot * (span[1] - span[0] + 1)} height={plotH} />}
          {current && <line className="chart-cross" x1={cx(active)} x2={cx(active)} y1={TOP} y2={TOP + plotH} />}
          {series.map((s, si) => kind === 'bar'
            ? points.map((p, i) => {
              const v = p.values[si];
              const x = cx(i) - (barW * series.length) / 2 + barW * si;
              if (v === null || v === undefined) return <rect key={`${s.name}${p.key}`} className="chart-gap" x={x} y={zero - 3} width={barW} height={3} />;
              if (v === 0) return null;
              const top = Math.min(y(v), zero);
              return <rect key={`${s.name}${p.key}`} className={`chart-s${si}${i === active ? ' on' : ''}`} x={x + 0.5} y={top} width={Math.max(1, barW - 1)} height={Math.max(1, Math.abs(y(v) - zero))} rx={2} />;
            })
            : <path key={s.name} className={`chart-line chart-l${si}`} d={points.reduce((d, p, i) => {
              const v = p.values[si];
              if (v === null || v === undefined) return d;
              const prev = i > 0 ? points[i - 1]!.values[si] : null;
              return `${d}${prev === null || prev === undefined ? 'M' : 'L'}${cx(i)} ${y(v)}`;
            }, '')} />)}
          {kind === 'line' && current && series.map((s, si) => {
            const v = current.values[si];
            return v === null || v === undefined ? null : <circle key={s.name} className={`chart-dot chart-d${si}`} cx={cx(active)} cy={y(v)} r={4} />;
          })}
        </svg>
        {current && (
          <div className="chart-tip" role="status" style={{ insetInlineStart: tooltipLeft(cx(active), TIP, width), width: TIP }}>
            <strong>{current.title}</strong>
            {series.map((s, si) => <div key={s.name}><span>{s.name}</span><b>{current.values[si] === null || current.values[si] === undefined ? t('Not recorded') : s.format(current.values[si]!)}</b></div>)}
            {current.extras?.map((x) => <div key={x.label}><span>{x.label}</span><b>{x.value}</b></div>)}
          </div>
        )}
      </div>
      {series.length > 1 && <div className="chart-legend">{series.map((s, si) => <span key={s.name}><i className={`chart-key chart-k${si}`} />{s.name}</span>)}</div>}
      <details className="more">
        <summary>{t('Show the numbers')}</summary>
        <table className="list" aria-label={`${name} numbers`}>
          <thead><tr><th>{t('When')}</th>{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
          <tbody>{points.map((p, i) => <tr key={p.key} tabIndex={onPick ? 0 : undefined} onClick={() => onPick?.(points[i]!)}><td>{p.title}</td>{p.values.map((v, si) => <td key={si} className="num">{v === null ? t('Not recorded') : series[si]!.format(v)}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

