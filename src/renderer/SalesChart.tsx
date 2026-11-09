import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../core/money';
import { longDay, rangeText, shortDay, type DayRange } from '../core/date-range';
import { storeDateTime } from '../core/store-time';
import type { SalesSummary } from '../services/reports';
import type { SaleRow, SalesPoint, SeriesUnit } from '../services/series';
import { call } from './api';
import { Chart, type ChartPoint } from './Chart';
import { Kpi, Views } from './Figures';
import { useI18n } from './i18n';
import { EmptyRow } from './PageHeader';

const shortAxis = (halalas: number) => {
  const sar = Math.floor(Math.abs(halalas) / 100);
  const text = sar >= 1000 ? `${Math.floor(sar / 100) / 10}K` : String(sar);
  return halalas < 0 ? `-${text}` : text;
};

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`;
const defaultUnit = (r: DayRange): SeriesUnit => (r.from === r.to ? 'hour' : Date.parse(r.to) - Date.parse(r.from) > 62 * 86_400_000 ? 'week' : 'day');

/** Sales over the chosen dates. Click a point for the sales behind it; drag across points to choose those dates. */
export function SalesChart({ dates, onDates, tick }: { dates: DayRange; onDates: (r: DayRange) => void; tick: number }) {
  const { t } = useI18n();
  const [unit, setUnit] = useState<SeriesUnit | null>(null);
  const [points, setPoints] = useState<SalesPoint[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<SalesPoint | null>(null);
  const before = useRef<DayRange | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const single = dates.from === dates.to;
  const shown: SeriesUnit = unit === 'hour' && !single ? 'day' : unit ?? defaultUnit(dates);

  useEffect(() => {
    setOpen(null);
    setError('');
    setPoints(null);
    call<SalesPoint[]>('report.series', { from: dates.from, to: dates.to, unit: shown }).then(setPoints, (e: Error) => setError(t(e.message)));
  }, [dates.from, dates.to, shown, tick]);

  const when = (p: SalesPoint) => (p.hour !== null ? `${longDay(p.from)}, ${hourText(p.hour)}` : p.from === p.to ? longDay(p.from) : rangeText({ from: p.from, to: p.to }));
  const chartPoints: ChartPoint[] = (points ?? []).map((p) => ({
    key: p.key,
    axis: p.hour !== null ? hourText(p.hour) : shortDay(p.from),
    title: when(p),
    values: [p.sales],
    extras: [
      { label: t('Transactions'), value: p.transactions === null ? t('Not recorded') : String(p.transactions) },
      { label: t('Average sale'), value: p.average === null ? '—' : formatMoney(p.average) },
      { label: t('Earlier period'), value: p.compare === null ? t('Not recorded') : formatMoney(p.compare) },
    ],
  }));
  const pick = (cp: ChartPoint) => setOpen((points ?? []).find((p) => p.key === cp.key) ?? null);
  const range = (a: ChartPoint, b: ChartPoint) => {
    const from = (points ?? []).find((p) => p.key === a.key);
    const to = (points ?? []).find((p) => p.key === b.key);
    if (!from || !to || from.hour !== null) return; // a drag across hours stays inside one day
    before.current = dates;
    setCanGoBack(true);
    onDates({ from: from.from, to: to.to });
  };
  const units: { id: SeriesUnit; label: string }[] = [
    ...(single ? [{ id: 'hour' as const, label: t('Hours') }] : []),
    { id: 'day', label: t('Days') }, { id: 'week', label: t('Weeks') }, { id: 'month', label: t('Months') },
  ];

  return (
    <section className="chart-card" aria-label="sales chart">
      <div className="chart-head">
        <h4>{t('Sales')} <small>{t('SAR, including VAT')}</small></h4>
        {canGoBack && <button type="button" onClick={() => { if (before.current) onDates(before.current); before.current = null; setCanGoBack(false); }}>{t('Back to previous dates')}</button>}
        <Views name="chart detail" value={shown} onChange={setUnit} options={units} />
      </div>
      {error && <p className="msg error">{error}</p>}
      {!points && !error && <p className="chart-empty">{t('Loading…')}</p>}
      {points && <Chart name={t('Sales')} kind="bar" series={[{ name: t('Sales'), format: formatMoney }]} points={chartPoints} axisFormat={shortAxis} onPick={pick} onRange={single ? undefined : range} info="metric.chart.sales" emptyText={t('No sales in these dates.')} />}
      {open && <PointDetail point={open} title={when(open)} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** What sits behind one chart point. It reads only, and closing it leaves the chart and dates as they were. */
function PointDetail({ point, title, onClose }: { point: SalesPoint; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const [sum, setSum] = useState<SalesSummary | null>(null);
  const [list, setList] = useState<{ rows: SaleRow[]; more: boolean } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const backTo = useRef<Element | null>(null);
  useEffect(() => {
    backTo.current = document.activeElement;
    panel.current?.focus();
    if (point.hour === null) void call<SalesSummary>('report.sales', { fromDay: point.from, toDay: point.to }).then(setSum, () => setSum(null));
    void call<{ rows: SaleRow[]; more: boolean }>('report.saleList', { from: point.from, to: point.to, hour: point.hour ?? undefined }).then(setList, () => setList(null));
  }, [point.key]);
  const close = () => {
    onClose();
    if (backTo.current instanceof HTMLElement) backTo.current.focus();
  };
  return (
    <div className="point-detail" ref={panel} tabIndex={-1} role="region" aria-label="sales detail" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <div className="chart-head"><h4>{title}</h4><button type="button" onClick={close}>{t('Close')}</button></div>
      <div className="kpis">
        <Kpi l={t('Total incl. VAT')} v={point.sales === null ? t('Not recorded') : formatMoney(point.sales)} />
        <Kpi l={t('Transactions')} v={point.transactions === null ? t('Not recorded') : String(point.transactions)} />
        {sum && <>
          <Kpi l={t('Cash (net of change)')} v={formatMoney(sum.cash)} sub={t('Before refunds')} />
          <Kpi l={t('Card')} v={formatMoney(sum.card)} />
          <Kpi l={t('Discounts given')} v={formatMoney(sum.totalDiscount)} />
          <Kpi l={t('Refunds ({0}, paid in cash)', sum.refundCount)} v={formatMoney(sum.refundTotal)} />
          <Kpi l={t('Net sales incl. VAT')} v={formatMoney(sum.netIncl)} />
        </>}
      </div>
      <table className="list" aria-label="sales in this point" style={{ marginTop: 'var(--sp-3)' }}>
        <thead><tr><th>{t('Time')}</th><th>{t('Invoice')}</th><th>{t('Cashier')}</th><th>{t('Customer')}</th><th>{t('Payment')}</th><th className="num">{t('Total')}</th></tr></thead>
        <tbody>{list?.rows.length === 0 && <EmptyRow cols={6} text={t('No sales in these dates.')} />}{list?.rows.map((r) => <tr key={r.invoiceNo}><td>{storeDateTime(r.at)}</td><td>{r.invoiceNo}</td><td>{r.cashier}</td><td>{r.customer ?? '—'}</td><td>{r.payments}</td><td className="num">{formatMoney(r.total)}</td></tr>)}</tbody>
      </table>
      {list?.more && <p className="hint">{t('Showing the newest 300. Choose fewer dates to see the rest.')}</p>}
    </div>
  );
}
