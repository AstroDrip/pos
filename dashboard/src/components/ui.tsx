import type { ReactNode } from 'react';
import { formatCount, formatSar, NOT_AVAILABLE, percentChange } from '@/lib/money';
import { PERIOD_CHOICES, rangeLabel, type Period } from '@/lib/period';
import type { Coverage } from '@/lib/summary';

export function Tile({ label, value, note, tag }: { label: string; value: string; note?: string; tag?: string }) {
  return (
    <div className="tile">
      <div className="label">{label} {tag && <span className="tag">{tag}</span>}</div>
      <div className={`value${value === NOT_AVAILABLE ? ' na' : ''}`}>{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export const MoneyTile = ({ label, value, note, tag }: { label: string; value: number | null | undefined; note?: string; tag?: string }) => <Tile label={label} value={formatSar(value)} note={note} tag={tag} />;
export const CountTile = ({ label, value, note }: { label: string; value: number | null | undefined; note?: string }) => <Tile label={label} value={formatCount(value)} note={note} />;

export function Hero({ label, value, now, before, compareLabel }: { label: string; value: number | null; now: number | null; before: number | null; compareLabel: string }) {
  const change = percentChange(now, before);
  return (
    <div className="card hero">
      <div className="label">{label}</div>
      <div className="value">{formatSar(value)}</div>
      <div className="delta">{change ? <><b>{change}</b> vs {compareLabel}</> : `No figures for ${compareLabel} to compare with`}</div>
    </div>
  );
}

export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}{note && <small>{note}</small>}</h2>
      {children}
    </section>
  );
}

export function Row({ label, sub, value, total }: { label: string; sub?: string; value: string; total?: boolean }) {
  return (
    <div className={`row${total ? ' total' : ''}`}>
      <span>{label}{sub && <small>{sub}</small>}</span>
      <span className="num">{value}</span>
    </div>
  );
}

export function PeriodBar({ period, path }: { period: Period; path: string }) {
  return (
    <>
      <nav className="periods" aria-label="Choose a period">
        {PERIOD_CHOICES.map((c) => (
          <a key={c.key} className={c.key === period.key ? 'on' : ''} aria-current={c.key === period.key ? 'true' : undefined} href={c.key === 'custom' ? `${path}?p=custom&from=${period.from}&to=${period.to}` : `${path}?p=${c.key}`}>{c.label}</a>
        ))}
      </nav>
      {period.key === 'custom' && (
        <form className="custom" method="get" action={path}>
          <input type="hidden" name="p" value="custom" />
          <label>From<input type="date" name="from" defaultValue={period.from} required /></label>
          <label>To<input type="date" name="to" defaultValue={period.to} required /></label>
          <button className="btn" type="submit">Show</button>
        </form>
      )}
      <p className="sub">{period.label} · {rangeLabel(period.from, period.to)} · Saudi time</p>
    </>
  );
}

export function CoverageNote({ c }: { c: Coverage }) {
  if (c.received === c.expected) return null;
  if (c.received === 0) return <p className="notice warn">No figures have been received for this period, so they show as “{NOT_AVAILABLE}”. This does not mean there were no sales.</p>;
  return <p className="notice warn">Only {c.received} of {c.expected} days have been received. The totals cover those days only.</p>;
}

export const Provisional = () => <p className="notice">Provisional figures for running the shop. They are not accountant-approved financial statements.</p>;

export function BarList({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="top"><span>{r.label}</span><span className="num">{format(r.value)}</span></div>
          <div className="track" aria-hidden="true"><i style={{ width: `${Math.max(1, Math.floor((Math.abs(r.value) * 100) / max))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;
