import { Card, CoverageNote, Empty, MoneyTile, PeriodBar, Row } from '@/components/ui';
import { formatSar, NOT_AVAILABLE } from '@/lib/money';
import { parsePeriod } from '@/lib/period';
import { summarise } from '@/lib/summary';
import type { CreditSnapshot } from '@/shared/snapshots';
import { loadCredit, loadDays, loadPosition, loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

type Search = Promise<Record<string, string | string[] | undefined>>;

function Ageing({ a }: { a: CreditSnapshot['customerAgeing'] }) {
  if (!a) return <Empty>Ageing is {NOT_AVAILABLE.toLowerCase()}.</Empty>;
  return (
    <div className="rows">
      <Row label="Not yet due" value={formatSar(a.current)} />
      <Row label="1 to 30 days late" value={formatSar(a.d1to30)} />
      <Row label="31 to 60 days late" value={formatSar(a.d31to60)} />
      <Row label="61 to 90 days late" value={formatSar(a.d61to90)} />
      <Row label="Over 90 days late" value={formatSar(a.over90)} />
    </div>
  );
}

const Balances = ({ rows, none }: { rows: CreditSnapshot['customers']; none: string }) => (rows.length === 0 ? <Empty>{none}</Empty> : <div className="rows">{rows.map((r) => <Row key={r.name} label={r.name} sub={r.overdue > 0 ? `${formatSar(r.overdue)} overdue` : undefined} value={formatSar(r.balance)} />)}</div>);

export default async function CreditPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const status = await loadStatus(user);
  const period = parsePeriod(await searchParams, status.today);
  const [days, credit, position] = await Promise.all([loadDays(user, period.from, period.to), loadCredit(user), loadPosition(user)]);
  const { totals: s, coverage } = summarise(days, period.from, period.to);
  return (
    <main className="page">
      <h2 className="title">Customers and suppliers</h2>
      <h3 className="sub">Right now, as of the till’s last report</h3>
      <div className="grid">
        <MoneyTile label="Customers owe the store" value={position?.receivablesOutstanding} note={position ? `${position.customersWithBalance ?? 0} customers` : undefined} />
        <MoneyTile label="Customers overdue" value={position?.receivablesOverdue} />
        <MoneyTile label="Store owes suppliers" value={position?.payablesOutstanding} note={position ? `${position.suppliersWithBalance ?? 0} suppliers` : undefined} />
        <MoneyTile label="Suppliers overdue" value={position?.payablesOverdue} />
      </div>
      <PeriodBar period={period} path="/credit" today={status.today} />
      <CoverageNote c={coverage} />
      <div className="grid">
        <MoneyTile label="Credit sales" value={s.onAccount} note="Sold on customer account" />
        <MoneyTile label="Credit purchases" value={s.supplierCreditPurchases} note="Bought on supplier credit" />
      </div>
      <Card title="Money owed to the store" note="largest first">{credit ? <Balances rows={credit.customers} none="No customer owes the store." /> : <Empty>{NOT_AVAILABLE}</Empty>}</Card>
      <Card title="Customer ageing"><Ageing a={credit?.customerAgeing ?? null} /></Card>
      <Card title="Money the store owes" note="largest first">{credit ? <Balances rows={credit.suppliers} none="The store owes no supplier." /> : <Empty>{NOT_AVAILABLE}</Empty>}</Card>
      <Card title="Supplier ageing"><Ageing a={credit?.supplierAgeing ?? null} /></Card>
    </main>
  );
}
