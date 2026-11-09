import { BarChart } from '@/components/BarChart';
import { BarList, Card, CountTile, CoverageNote, Empty, MoneyTile, PeriodBar } from '@/components/ui';
import { formatQty, formatSar } from '@/lib/money';
import { addDays, dayDiff, monthStart, parsePeriod, shortDay, shortMonth, weekStart } from '@/lib/period';
import { bucketSeries, dailySeries, summarise } from '@/lib/summary';
import { loadDays, loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SalesPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const status = await loadStatus(user);
  const period = parsePeriod(await searchParams, status.today);
  const weeksFrom = addDays(weekStart(status.today), -7 * 11);
  const monthsFrom = monthStart(addDays(monthStart(status.today), -300));
  const earliest = [period.from, weeksFrom, monthsFrom].sort()[0]!;
  const days = await loadDays(user, earliest, status.today);
  const { totals: s, coverage, byCategory, byProduct } = summarise(days, period.from, period.to);
  const long = dayDiff(period.from, period.to) > 62;

  const methods = s.salesInclVat === null ? [] : [{ label: 'Cash', value: s.cash! }, { label: 'Card', value: s.card! }, { label: 'On customer account', value: s.onAccount! }].filter((m) => m.value !== 0);

  return (
    <main className="page">
      <h2 className="title">Sales</h2>
      <PeriodBar period={period} path="/sales" today={status.today} />
      <CoverageNote c={coverage} />
      <div className="grid">
        <MoneyTile label="Sales, including VAT" value={s.salesInclVat} />
        <CountTile label="Transactions" value={s.transactions} />
        <MoneyTile label="Average sale" value={s.averageSale} />
        <MoneyTile label="Returns" value={s.returns} note="Excluding VAT" />
        <MoneyTile label="Discounts given" value={s.discounts} />
      </div>
      <Card title="Daily sales" note="including VAT">
        {long ? <BarChart title="Sales by week" unit="SAR, including VAT, by week" points={bucketSeries(days, period.from, period.to, 'salesInclVat', 'week')} label={shortDay} /> : <BarChart title="Daily sales" unit="SAR, including VAT, by day" points={dailySeries(days, period.from, period.to, 'salesInclVat')} label={shortDay} />}
      </Card>
      <Card title="Weekly trend" note="last 12 weeks">
        <BarChart title="Weekly sales" unit="SAR, including VAT. Week starts Sunday" points={bucketSeries(days, weeksFrom, status.today, 'salesInclVat', 'week')} label={shortDay} />
      </Card>
      <Card title="Monthly trend">
        <BarChart title="Monthly sales" unit="SAR, including VAT, by month" points={bucketSeries(days, monthsFrom, status.today, 'salesInclVat', 'month')} label={shortMonth} />
      </Card>
      <Card title="By payment method">
        {methods.length ? <BarList rows={methods} format={formatSar} /> : <Empty>No sales figures for this period.</Empty>}
      </Card>
      <Card title="By product category" note="excluding VAT, before returns">
        {byCategory.length ? <BarList rows={byCategory.slice(0, 12).map((c) => ({ label: c.name, value: c.net }))} format={formatSar} /> : <Empty>No category figures for this period.</Empty>}
      </Card>
      <Card title="Best sellers" note="by sales value">
        {byProduct.length ? (
          <table className="tbl">
            <thead><tr><th scope="col">Product</th><th scope="col">Qty</th><th scope="col">Sales</th></tr></thead>
            <tbody>{byProduct.slice(0, 10).map((p) => <tr key={p.sku}><td>{p.name}</td><td>{formatQty(p.qty)}</td><td>{formatSar(p.net)}</td></tr>)}</tbody>
          </table>
        ) : <Empty>No product figures for this period.</Empty>}
      </Card>
    </main>
  );
}
