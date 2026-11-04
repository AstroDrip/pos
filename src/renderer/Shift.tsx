import { useEffect, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import type { ShiftSummary } from '../services/shifts';
import { call } from './api';

export function Shift({ can }: { can: (p: string) => boolean }) {
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
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  if (!s) return <div className="card">No open shift. Open one from the Sell tab.{msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}</div>;

  return (
    <div className="card">
      <h3>Shift #{s.shiftId}</h3>
      <table className="list">
        <tbody>
          <tr><td>Opening float</td><td className="num">{formatSar(s.openingFloat)}</td></tr>
          <tr><td>Sales ({s.saleCount})</td><td /></tr>
          <tr><td>Cash sales</td><td className="num">{formatSar(s.cashSales)}</td></tr>
          <tr><td>Card sales</td><td className="num">{formatSar(s.cardSales)}</td></tr>
          <tr><td>Cash in / out</td><td className="num">{formatSar(s.cashIn)} / {formatSar(s.cashOut)}</td></tr>
          <tr><td><strong>Expected cash in drawer</strong></td><td className="num"><strong>{formatSar(s.expectedCash)}</strong></td></tr>
        </tbody>
      </table>

      {can('cash.move') && (
        <>
          <h4>Cash in / out</h4>
          <div className="row">
            <select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value as 'in' | 'out' })}>
              <option value="out">Out</option>
              <option value="in">In</option>
            </select>
            <input placeholder="Amount" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} />
          </div>
          <label>Reason</label>
          <input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
          <p>
            <button onClick={() => run(() => call('cash.move', { kind: move.kind, amount: parseSar(move.amount), reason: move.reason }), 'Recorded')}>
              Record
            </button>
          </p>
        </>
      )}

      <h4>Close shift</h4>
      <label>Counted cash in drawer (SAR)</label>
      <input value={counted} onChange={(e) => setCounted(e.target.value)} />
      <p>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              const r = await call<ShiftSummary>('shift.close', { countedCash: parseSar(counted) });
              const diff = (r.countedCash ?? 0) - r.expectedCash;
              window.alert(`Shift closed. Expected ${formatSar(r.expectedCash)}, counted ${formatSar(r.countedCash ?? 0)}, difference ${formatSar(diff)}.`);
            }, 'Shift closed')
          }
        >
          Close shift
        </button>
      </p>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
