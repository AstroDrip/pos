import { Card, Row } from '@/components/ui';
import { FRESHNESS_TEXT, riyadhTime } from '@/lib/freshness';
import { formatSar, NOT_AVAILABLE } from '@/lib/money';
import { summarise } from '@/lib/summary';
import { loadDays, loadPosition, loadShift, loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

export default async function SyncPage() {
  const user = await requireUser();
  const [status, position, shift] = await Promise.all([loadStatus(user), loadPosition(user), loadShift(user)]);
  const r = position?.reconcile ?? null;
  const here = r ? summarise(await loadDays(user, r.fromDay, r.toDay), r.fromDay, r.toDay) : null;
  const matches = r && here ? here.coverage.missing.length === 0 && here.totals.salesInclVat === r.salesInclVat && here.totals.transactions === r.transactions && here.totals.netProfit === r.netProfit : null;
  return (
    <main className="page">
      <h2 className="title">Till connection</h2>
      <p className={`notice${status.freshness === 'live' || status.freshness === 'demo' ? '' : ' warn'}`}>{FRESHNESS_TEXT[status.freshness]}</p>
      <Card title="Last contact">
        <div className="rows">
          <Row label="Last successful sync" value={riyadhTime(status.lastSuccessAt)} />
          <Row label="Last new data" value={riyadhTime(status.lastDataAt)} />
          <Row label="Till" value={status.deviceName ?? NOT_AVAILABLE} />
          <Row label="App version" value={status.appVersion ?? NOT_AVAILABLE} />
        </div>
      </Card>
      <Card title="Open shift">
        <div className="rows">
          {!shift ? <Row label="Shift" value={NOT_AVAILABLE} /> : !shift.open ? <Row label="Shift" value="No shift open" /> : <>
            <Row label="Cashier" value={shift.cashier} />
            <Row label="Opened" value={riyadhTime(shift.openedAt)} />
            <Row label="Opening cash" value={formatSar(shift.openingFloat)} />
            <Row label="Expected cash" value={formatSar(shift.expectedCash)} />
          </>}
        </div>
      </Card>
      <Card title="Do these figures match the till?">
        {!r || !here ? <p className="sub">{NOT_AVAILABLE}</p> : <>
          <p className={`notice${matches ? '' : ' bad'}`}>{matches ? 'Yes. The daily figures here add up to the totals the till reported.' : 'No. Some days are missing or differ from the totals the till reported.'}</p>
          <div className="rows" style={{ marginTop: 8 }}>
            <Row label="Sales, on the till" sub={`${r.fromDay} to ${r.toDay}`} value={formatSar(r.salesInclVat)} />
            <Row label="Sales, added up here" value={formatSar(here.totals.salesInclVat)} />
          </div>
        </>}
      </Card>
      {position?.integrity && <Card title="Till’s books check"><Row label={`Checked ${riyadhTime(position.integrity.checkedAt)}`} value={`${position.integrity.critical} problems, ${position.integrity.warnings} warnings`} /></Card>}
    </main>
  );
}
