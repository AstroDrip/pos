import { BarChart } from '@/components/BarChart';
import { BarList, Card, CoverageNote, Empty, PeriodBar, Provisional, Row } from '@/components/ui';
import { formatSar } from '@/lib/money';
import { addDays, monthStart, parsePeriod, shortMonth } from '@/lib/period';
import { bucketSeries, summarise } from '@/lib/summary';
import { loadDays, loadPosition, loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ProfitPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const status = await loadStatus(user);
  const period = parsePeriod(await searchParams, status.today);
  const monthsFrom = monthStart(addDays(monthStart(status.today), -300));
  const earliest = [period.from, monthsFrom].sort()[0]!;
  const [days, position] = await Promise.all([loadDays(user, earliest, status.today), loadPosition(user)]);
  const { totals: s, coverage, expenses } = summarise(days, period.from, period.to);
  return (
    <main className="page">
      <h2 className="title">Profit and expenses</h2>
      <Provisional />
      <PeriodBar period={period} path="/profit" />
      <CoverageNote c={coverage} />
      <Card title="Result for the period" note="excluding VAT">
        <div className="rows">
          <Row label="Revenue" sub="Net sales after returns" value={formatSar(s.netSales)} />
          <Row label="Cost of goods sold" value={formatSar(s.cogs)} />
          <Row label="Gross profit" value={formatSar(s.grossProfit)} total />
          <Row label="Operating expenses" value={formatSar(s.operatingExpenses)} />
          <Row label="Net operating result" sub="Provisional" value={formatSar(s.netProfit)} total />
        </div>
      </Card>
      <p className="sub">Cash received is not the same as revenue or profit. Customer payments, supplier payments and VAT move cash without being income or cost.</p>
      {position && position.prepaidWaiting !== null && position.prepaidWaiting > 0 && <p className="notice warn">Prepaid expenses of {formatSar(position.prepaidWaiting)} are due but have not been recognised on the till, so they are not in these expenses yet.</p>}
      <Card title="Expenses by type">
        {expenses.length ? <BarList rows={expenses.filter((e) => e.amount !== 0).map((e) => ({ label: e.name, value: e.amount }))} format={formatSar} /> : <Empty>No expense figures for this period.</Empty>}
      </Card>
      <Card title="Net result by month" note="provisional">
        <BarChart title="Net operating result by month" unit="SAR, by month" points={bucketSeries(days, monthsFrom, status.today, 'netProfit', 'month')} label={shortMonth} />
      </Card>
      <Card title="Gross profit by month">
        <BarChart title="Gross profit by month" unit="SAR, by month" points={bucketSeries(days, monthsFrom, status.today, 'grossProfit', 'month')} label={shortMonth} />
      </Card>
      {position && position.provisionalReasons.length > 0 && (
        <Card title="Why these are provisional">
          <ul className="sub" style={{ margin: 0, paddingInlineStart: 18 }}>{position.provisionalReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      )}
    </main>
  );
}
