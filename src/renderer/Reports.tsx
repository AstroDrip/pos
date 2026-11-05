import { useEffect, useState } from 'react';
import { formatQty, formatSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { SalesSummary, VoidRow } from '../services/reports';
import { call } from './api';
import { useI18n } from './i18n';

const today = () => storeDay(new Date().toISOString());

export function Reports() {
  const { t } = useI18n();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [r, setR] = useState<SalesSummary | null>(null);
  const [voids, setVoids] = useState<VoidRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    // Days are Saudi-time business days (UTC+3); the main process converts them.
    setError('');
    call<SalesSummary>('report.sales', { fromDay: from, toDay: to }).then(setR, (e: Error) => setError(e.message));
    call<VoidRow[]>('report.voids', { fromDay: from, toDay: to }).then(setVoids, () => setVoids([]));
  }, [from, to]);

  return (
    <div className="page">
      <div className="row" style={{ maxWidth: 420 }}>
        <div><label>{t('From')}</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>{t('To')}</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <p className="msg error">{error}</p>}
      {r && (
        <>
          <table className="list" style={{ maxWidth: 420, marginTop: 12 }}>
            <tbody>
              <tr><td>{t('Sales')}</td><td className="num">{r.saleCount}</td></tr>
              <tr><td>{t('Total incl. VAT')}</td><td className="num">{formatSar(r.totalIncl)}</td></tr>
              <tr><td>{t('VAT')}</td><td className="num">{formatSar(r.totalVat)}</td></tr>
              <tr><td>{t('Total excl. VAT')}</td><td className="num">{formatSar(r.totalExcl)}</td></tr>
              <tr><td>{t('Discounts given')}</td><td className="num">{formatSar(r.totalDiscount)}</td></tr>
              <tr><td>{t('Cash (net of change)')}</td><td className="num">{formatSar(r.cash)}</td></tr>
              <tr><td>{t('Card')}</td><td className="num">{formatSar(r.card)}</td></tr>
            </tbody>
          </table>
          <h4>{t('By day')}</h4>
          <table className="list">
            <thead><tr><th>{t('Day')}</th><th className="num">{t('Sales')}</th><th className="num">{t('Total')}</th><th className="num">{t('VAT')}</th></tr></thead>
            <tbody>{r.byDay.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.saleCount}</td><td className="num">{formatSar(d.totalIncl)}</td><td className="num">{formatSar(d.totalVat)}</td></tr>)}</tbody>
          </table>
          <h4>{t('Top products')}</h4>
          <table className="list">
            <thead><tr><th>{t('Product')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Total')}</th></tr></thead>
            <tbody>{r.topProducts.map((p) => <tr key={p.productId}><td>{p.nameEn}</td><td className="num">{formatQty(p.qty)}</td><td className="num">{formatSar(p.totalIncl)}</td></tr>)}</tbody>
          </table>
          <h4>{t('Items removed before payment ({0})', voids.length)}</h4>
          <table className="list">
            <thead><tr><th>{t('Time')}</th><th>{t('User')}</th><th>{t('Invoice')}</th><th>{t('Type')}</th><th className="num">{t('Items')}</th><th className="num">{t('Value')}</th></tr></thead>
            <tbody>{voids.map((v, i) => <tr key={i}><td>{new Date(v.at).toLocaleString()}</td><td>{v.user}</td><td>{v.invoiceNo ?? t('Not paid')}</td><td>{v.kind === 'bill_cleared' ? t('Bill cleared') : t('Line removed')}</td><td className="num">{v.items}</td><td className="num">{formatSar(v.total)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
