import { useEffect, useState } from 'react';
import { formatMoney, formatSar, parseSar } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { PastShift, ShiftEvent, ShiftSummary } from '../services/shifts';
import { call } from './api';
import { Kpi, Views } from './Figures';
import { HelpLink } from './HelpLink';
import { validOneOf } from './remember';
import { InfoIcon } from './InfoIcon';
import { useRemembered, useReturnTick } from './TabHost';
import { useI18n } from './i18n';
import { EmptyRow, PageHeader } from './PageHeader';

export function Shift({ can, onUserChange }: { can: (p: string) => boolean; onUserChange?: () => void }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [s, setS] = useState<ShiftSummary | null>(null);
  const [counted, setCounted] = useState('');
  const [move, setMove] = useState({ kind: 'out' as 'in' | 'out', amount: '', reason: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [hand, setHand] = useState({ counted: '', username: '', pin: '' });

  const [view, setView] = useRemembered<'now' | 'cash' | 'close' | 'handover' | 'past'>('shift', 'view', 'now', validOneOf(['now', 'cash', 'close', 'handover', 'past']));
  const load = () => call<ShiftSummary | null>('shift.current').then(setS);
  useEffect(() => void load(), [back]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      void load();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  const past = can('reports.view') && <PastShifts refresh={msg} />;
  if (!s) return <div className="page"><PageHeader title={t('Shift')} actions={<HelpLink article="shifts-close" />} /><p className="msg warn">{t('No open shift. Open one from the Sell tab.')}</p>{msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}{past}</div>;

  return (
    <div className="page">
    <PageHeader title={t('Shift #{0}', s.shiftId)} actions={<HelpLink article="shifts-close" />} />
    <div className="kpis">
      <Kpi lead info="metric.shift.expected" l={t('Expected cash in drawer')} v={formatMoney(s.expectedCash)} />
      <Kpi info="metric.shift.float" l={t('Opening float')} v={formatMoney(s.openingFloat)} />
      <Kpi l={t('Sales ({0})', s.saleCount)} v={formatMoney(s.cashSales + s.cardSales)} />
    </div>
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <Views name="shift view" value={view} onChange={setView} options={[
        { id: 'now', label: t('This shift') },
        ...(can('cash.move') ? [{ id: 'cash' as const, label: t('Cash in / out') }] : []),
        { id: 'close', label: t('Close shift') }, { id: 'handover', label: t('Handover') },
        ...(can('reports.view') ? [{ id: 'past' as const, label: t('Past shifts') }] : []),
      ]} />
    </div>
    {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    <div className="card section" hidden={view !== 'now'}>
      <table className="list">
        <tbody>
          <tr><td>{t('Opening float')} <InfoIcon id="metric.shift.float" /></td><td className="num">{formatSar(s.openingFloat)}</td></tr>
          <tr><td>{t('Sales ({0})', s.saleCount)}</td><td /></tr>
          <tr><td>{t('Cash sales')} <InfoIcon id="metric.shift.cash" /></td><td className="num">{formatSar(s.cashSales)}</td></tr>
          <tr><td>{t('Card sales')} <InfoIcon id="metric.shift.card" /></td><td className="num">{formatSar(s.cardSales)}</td></tr>
          <tr><td>{t('Cash in / out')} <InfoIcon id="metric.shift.moves" /></td><td className="num">{formatSar(s.cashIn)} / {formatSar(s.cashOut)}</td></tr>
          <tr><td>{t('Refunds paid in cash ({0})', s.refundCount)} <InfoIcon id="metric.shift.refunds" /></td><td className="num">{formatSar(s.cashRefunds)}</td></tr>
          <tr><td><strong>{t('Expected cash in drawer')}</strong></td><td className="num"><strong>{formatSar(s.expectedCash)}</strong></td></tr>
        </tbody>
      </table>
      <ShiftActivity shiftId={s.shiftId} tick={msg} />
    </div>
    <div className="card section" hidden={view !== 'cash'}>
      {can('cash.move') && (
        <>
          <h4 style={{ marginTop: 0 }}>{t('Cash in / out')}</h4>
          <div className="row">
            <select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value as 'in' | 'out' })}>
              <option value="out">{t('Out')}</option>
              <option value="in">{t('In')}</option>
            </select>
            <input placeholder={t('Amount')} value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} />
          </div>
          <label>{t('Reason')} <InfoIcon id="field.cash.reason" /></label>
          <input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
          <p>
            <button onClick={() => run(() => call('cash.move', { kind: move.kind, amount: parseSar(move.amount), reason: move.reason }), t('Recorded'))}>
              {t('Record')}
            </button>
          </p>
        </>
      )}
    </div>
    <div className="card section" hidden={view !== 'close'}>
      <h4 style={{ marginTop: 0 }}>{t('Close shift')}</h4>
      <label>{t('Counted cash in drawer (SAR)')} <InfoIcon id="field.shift.counted" /></label>
      <input value={counted} onChange={(e) => setCounted(e.target.value)} />
      <p>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              const r = await call<ShiftSummary>('shift.close', { countedCash: parseSar(counted) });
              const diff = (r.countedCash ?? 0) - r.expectedCash;
              window.alert(t('Shift closed. Expected {0}, counted {1}, difference {2}.', formatSar(r.expectedCash), formatSar(r.countedCash ?? 0), formatSar(diff)));
            }, t('Shift closed'))
          }
        >
          {t('Close shift')}
        </button>
      </p>
    </div>
    <div className="card section" hidden={view !== 'handover'}>
      <h4 style={{ marginTop: 0 }}>{t('Hand over to the next cashier')}</h4>
      <p className="hint">{t('Count the drawer, then the next cashier types their username and PIN. Your shift closes and theirs opens with this cash.')}</p>
      <div className="row">
        <div><label>{t('Counted cash in drawer (SAR)')} <InfoIcon id="field.shift.counted" /></label><input aria-label="handover counted cash" value={hand.counted} onChange={(e) => setHand({ ...hand, counted: e.target.value })} /></div>
        <div><label>{t('Next cashier username')} <InfoIcon id="field.shift.nextUser" /></label><input aria-label="handover username" value={hand.username} onChange={(e) => setHand({ ...hand, username: e.target.value })} /></div>
        <div><label>{t('Next cashier PIN')}</label><input aria-label="handover pin" type="password" inputMode="numeric" value={hand.pin} onChange={(e) => setHand({ ...hand, pin: e.target.value })} /></div>
      </div>
      <p>
        <button
          disabled={!hand.counted.trim() || !hand.username.trim() || !hand.pin}
          onClick={() =>
            run(async () => {
              const pin = hand.pin;
              setHand((h) => ({ ...h, pin: '' })); // used once: a wrong PIN must be typed again, not re-sent
              const r = await call<{ closed: ShiftSummary }>('shift.handover', { countedCash: parseSar(hand.counted), username: hand.username, pin });
              setHand({ counted: '', username: '', pin: '' });
              window.alert(t('Shift handed over. Expected {0}, counted {1}, difference {2}.', formatSar(r.closed.expectedCash), formatSar(r.closed.countedCash ?? 0), formatSar((r.closed.countedCash ?? 0) - r.closed.expectedCash)));
              onUserChange?.();
            }, t('Shift handed over'))
          }
        >
          {t('Hand over')}
        </button>
      </p>
    </div>
    <div hidden={view !== 'past'}>{past}</div>
    </div>
  );
}

/** What has happened in this shift, newest first. It only lists. */
function ShiftActivity({ shiftId, tick }: { shiftId: number; tick: unknown }) {
  const { t } = useI18n();
  const back = useReturnTick();
  const [rows, setRows] = useState<ShiftEvent[]>([]);
  useEffect(() => void call<ShiftEvent[]>('shift.activity', { shiftId }).then(setRows, () => setRows([])), [shiftId, tick, back]);
  const LABEL: Record<ShiftEvent['kind'], string> = { sale: 'Sale', refund: 'Refund', cash_in: 'Cash in', cash_out: 'Cash out' };
  return (
    <>
      <h4>{t('Activity')}</h4>
      <table className="list" aria-label="shift activity">
        <thead><tr><th>{t('Time')}</th><th>{t('What happened')}</th><th>{t('Details')}</th><th>{t('User')}</th><th className="num">{t('Amount')}</th></tr></thead>
        <tbody>{rows.length === 0 && <EmptyRow cols={5} text={t('Nothing yet in this shift.')} />}{rows.map((e, i) => <tr key={i}><td>{storeDateTime(e.at)}</td><td>{t(LABEL[e.kind])}</td><td>{e.detail}</td><td>{e.user}</td><td className={`num${e.amount < 0 ? ' neg' : ''}`}>{formatSar(e.amount)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

/** Earlier shifts with their cash differences. Only for people who can see reports. */
function PastShifts({ refresh }: { refresh: unknown }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [rows, setRows] = useState<PastShift[]>([]);
  useEffect(() => void call<PastShift[]>('shift.history', { limit: 60 }).then(setRows, () => setRows([])), [refresh, back]);
  return (
    <div className="card">
      <h3>{t('Past shifts')}</h3>
      <table className="list" aria-label="past shifts">
        <thead><tr><th>#</th><th>{t('Opened')}</th><th>{t('Closed')}</th><th>{t('Opened by')}</th><th className="num">{t('Sales')}</th><th className="num">{t('Total')}</th><th className="num">{t('Expected')}</th><th className="num">{t('Counted')}</th><th className="num">{t('Difference')}</th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={9} text={t('No shifts yet.')} />}
          {rows.map((r) => (
            <tr key={r.shiftId}>
              <td>{r.shiftId}</td><td>{storeDateTime(r.openedAt)}</td><td>{r.closedAt ? storeDateTime(r.closedAt) : t('Open')}</td><td>{r.openedBy}</td>
              <td className="num">{r.saleCount}</td><td className="num">{formatSar(r.salesTotal)}</td>
              <td className="num">{r.expectedCash === null ? '' : formatSar(r.expectedCash)}</td><td className="num">{r.countedCash === null ? '' : formatSar(r.countedCash)}</td>
              <td className="num">{r.difference === null ? '' : formatSar(r.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
