import { CountTile, CoverageNote, Hero, MoneyTile, PeriodBar } from '@/components/ui';
import { addDays, monthStart, parsePeriod, rangeLabel, weekStart } from '@/lib/period';
import { summarise } from '@/lib/summary';
import { loadDays, loadPosition, loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

type Search = Promise<Record<string, string | string[] | undefined>>;

const earliest = (...days: string[]) => days.reduce((a, b) => (a < b ? a : b));

export default async function OverviewPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const status = await loadStatus(user);
  const period = parsePeriod(await searchParams, status.today);
  const week = weekStart(status.today);
  const month = monthStart(status.today);
  const [days, position] = await Promise.all([loadDays(user, earliest(period.prevFrom, week, month), status.today), loadPosition(user)]);

  const s = summarise(days, period.from, period.to).totals;
  const coverage = summarise(days, period.from, period.to).coverage;
  const prev = summarise(days, period.prevFrom, period.prevTo).totals;
  const today = summarise(days, status.today, status.today).totals;
  const thisWeek = summarise(days, week, status.today).totals;
  const thisMonth = summarise(days, month, status.today).totals;

  return (
    <main className="page">
      <h2 className="title">Overview</h2>
      <div className="grid three">
        <MoneyTile label="Today" value={today.salesInclVat} />
        <MoneyTile label="This week" value={thisWeek.salesInclVat} />
        <MoneyTile label="This month" value={thisMonth.salesInclVat} />
      </div>
      <PeriodBar period={period} path="/" />
      <CoverageNote c={coverage} />
      <Hero label="Sales, including VAT" value={s.salesInclVat} now={s.salesInclVat} before={prev.salesInclVat} compareLabel={rangeLabel(period.prevFrom, addDays(period.prevTo, 0))} />
      <div className="grid">
        <CountTile label="Transactions" value={s.transactions} />
        <MoneyTile label="Average sale" value={s.averageSale} />
        <MoneyTile label="Gross profit" value={s.grossProfit} />
        <MoneyTile label="Net profit" value={s.netProfit} tag="Provisional" />
        <MoneyTile label="Expenses" value={s.operatingExpenses} />
        <MoneyTile label="Cash sales" value={s.cash} />
        <MoneyTile label="Card sales" value={s.card} />
      </div>
      {position?.integrity && position.integrity.critical > 0 && <p className="notice bad">The till’s books check found {position.integrity.critical} problem(s). Treat these figures with care until it is looked at.</p>}
      <h3 className="sub">Right now, as of the till’s last report</h3>
      <div className="grid">
        <MoneyTile label="Customers owe the store" value={position?.receivablesOutstanding} />
        <MoneyTile label="Store owes suppliers" value={position?.payablesOutstanding} />
        <MoneyTile label="Stock value" value={position?.inventoryValue} />
      </div>
    </main>
  );
}
