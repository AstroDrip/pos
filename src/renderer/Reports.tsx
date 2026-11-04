import { useEffect, useState } from 'react';
import { formatQty, formatSar } from '../core/money';
import type { SalesSummary } from '../services/reports';
import { call } from './api';

const day = (d: Date) => d.toISOString().slice(0, 10);

export function Reports() {
  const [from, setFrom] = useState(day(new Date()));
  const [to, setTo] = useState(day(new Date()));
  const [r, setR] = useState<SalesSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Dates are whole UTC days for now; store-local (UTC+3) day boundaries come with the reporting phase.
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    call<SalesSummary>('report.sales', { from: `${from}T00:00:00.000Z`, to: end.toISOString() }).then(setR, (e: Error) => setError(e.message));
  }, [from, to]);

  return (
    <div className="page">
      <div className="row" style={{ maxWidth: 420 }}>
        <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <p className="msg error">{error}</p>}
      {r && (
        <>
          <table className="list" style={{ maxWidth: 420, marginTop: 12 }}>
            <tbody>
              <tr><td>Sales</td><td className="num">{r.saleCount}</td></tr>
              <tr><td>Total incl. VAT</td><td className="num">{formatSar(r.totalIncl)}</td></tr>
              <tr><td>VAT</td><td className="num">{formatSar(r.totalVat)}</td></tr>
              <tr><td>Total excl. VAT</td><td className="num">{formatSar(r.totalExcl)}</td></tr>
              <tr><td>Discounts given</td><td className="num">{formatSar(r.totalDiscount)}</td></tr>
              <tr><td>Cash (net of change)</td><td className="num">{formatSar(r.cash)}</td></tr>
              <tr><td>Card</td><td className="num">{formatSar(r.card)}</td></tr>
            </tbody>
          </table>
          <h4>By day</h4>
          <table className="list">
            <thead><tr><th>Day</th><th className="num">Sales</th><th className="num">Total</th><th className="num">VAT</th></tr></thead>
            <tbody>{r.byDay.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.saleCount}</td><td className="num">{formatSar(d.totalIncl)}</td><td className="num">{formatSar(d.totalVat)}</td></tr>)}</tbody>
          </table>
          <h4>Top products</h4>
          <table className="list">
            <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Total</th></tr></thead>
            <tbody>{r.topProducts.map((p) => <tr key={p.productId}><td>{p.nameEn}</td><td className="num">{formatQty(p.qty)}</td><td className="num">{formatSar(p.totalIncl)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
