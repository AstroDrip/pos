import { useEffect, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { PastShift, ShiftSummary } from '../services/shifts';
import { call } from './api';
import { useI18n } from './i18n';
import { EmptyRow } from './PageHeader';

export function Shift({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [s, setS] = useState<ShiftSummary | null>(null);
  const [counted, setCounted] = useState('');
  const [move, setMove] = useState({ kind: 'out' as 'in' | 'out', amount: '', reason: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = () => call<ShiftSummary | null>('shift.current').then(setS);
  useEffect(() => void load(), []);

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
  if (!s) return <><div className="card">{t('No open shift. Open one from the Sell tab.')}{msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}</div>{past}</>;

  return (
    <>
    <div className="card">
      <h3>{t('Shift #{0}', s.shiftId)}</h3>
      <table className="list">
        <tbody>
          <tr><td>{t('Opening float')}</td><td className="num">{formatSar(s.openingFloat)}</td></tr>
          <tr><td>{t('Sales ({0})', s.saleCount)}</td><td /></tr>
          <tr><td>{t('Cash sales')}</td><td className="num">{formatSar(s.cashSales)}</td></tr>
          <tr><td>{t('Card sales')}</td><td className="num">{formatSar(s.cardSales)}</td></tr>
          <tr><td>{t('Cash in / out')}</td><td className="num">{formatSar(s.cashIn)} / {formatSar(s.cashOut)}</td></tr>
          <tr><td>{t('Refunds paid in cash ({0})', s.refundCount)}</td><td className="num">{formatSar(s.cashRefunds)}</td></tr>
          <tr><td><strong>{t('Expected cash in drawer')}</strong></td><td className="num"><strong>{formatSar(s.expectedCash)}</strong></td></tr>
        </tbody>
      </table>

      {can('cash.move') && (
        <>
          <h4>{t('Cash in / out')}</h4>
          <div className="row">
            <select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value as 'in' | 'out' })}>
              <option value="out">{t('Out')}</option>
              <option value="in">{t('In')}</option>
            </select>
            <input placeholder={t('Amount')} value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} />
          </div>
          <label>{t('Reason')}</label>
          <input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
          <p>
            <button onClick={() => run(() => call('cash.move', { kind: move.kind, amount: parseSar(move.amount), reason: move.reason }), t('Recorded'))}>
              {t('Record')}
            </button>
          </p>
        </>
      )}

      <h4>{t('Close shift')}</h4>
      <label>{t('Counted cash in drawer (SAR)')}</label>
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
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
    {past}
    </>
  );
}

/** Earlier shifts with their cash differences. Only for people who can see reports. */
function PastShifts({ refresh }: { refresh: unknown }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PastShift[]>([]);
  useEffect(() => void call<PastShift[]>('shift.history', { limit: 60 }).then(setRows, () => setRows([])), [refresh]);
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
