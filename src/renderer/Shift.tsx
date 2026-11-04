import { useEffect, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import type { ShiftSummary } from '../services/shifts';
import { call } from './api';
import { useI18n } from './i18n';

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

  if (!s) return <div className="card">{t('No open shift. Open one from the Sell tab.')}{msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}</div>;

  return (
    <div className="card">
      <h3>{t('Shift #{0}', s.shiftId)}</h3>
      <table className="list">
        <tbody>
          <tr><td>{t('Opening float')}</td><td className="num">{formatSar(s.openingFloat)}</td></tr>
          <tr><td>{t('Sales ({0})', s.saleCount)}</td><td /></tr>
          <tr><td>{t('Cash sales')}</td><td className="num">{formatSar(s.cashSales)}</td></tr>
          <tr><td>{t('Card sales')}</td><td className="num">{formatSar(s.cardSales)}</td></tr>
          <tr><td>{t('Cash in / out')}</td><td className="num">{formatSar(s.cashIn)} / {formatSar(s.cashOut)}</td></tr>
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
  );
}
