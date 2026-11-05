import { useEffect, useState } from 'react';
import { formatQty, formatSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { AdjustmentRow, CashierActivity, RefundRow, SalesSummary, VoidRow } from '../services/reports';
import { call } from './api';
import { useI18n } from './i18n';

const today = () => storeDay(new Date().toISOString());

export function Reports() {
  const { t } = useI18n();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [r, setR] = useState<SalesSummary | null>(null);
  const [voids, setVoids] = useState<VoidRow[]>([]);
  const [cashiers, setCashiers] = useState<CashierActivity[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    // Days are Saudi-time business days (UTC+3); the main process converts them.
    setError('');
    call<SalesSummary>('report.sales', { fromDay: from, toDay: to }).then(setR, (e: Error) => setError(e.message));
    call<VoidRow[]>('report.voids', { fromDay: from, toDay: to }).then(setVoids, () => setVoids([]));
    call<CashierActivity[]>('report.cashiers', { fromDay: from, toDay: to }).then(setCashiers, () => setCashiers([]));
    call<RefundRow[]>('report.refunds', { fromDay: from, toDay: to }).then(setRefunds, () => setRefunds([]));
    call<AdjustmentRow[]>('report.adjustments', { fromDay: from, toDay: to }).then(setAdjustments, () => setAdjustments([]));
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
              <tr><td>{t('Refunds ({0}, paid in cash)', r.refundCount)}</td><td className="num">-{formatSar(r.refundTotal)}</td></tr>
              <tr><td><strong>{t('Net sales incl. VAT')}</strong></td><td className="num"><strong>{formatSar(r.netIncl)}</strong></td></tr>
              <tr><td>{t('Net VAT')}</td><td className="num">{formatSar(r.netVat)}</td></tr>
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
          <h4>{t('Activity by cashier')}</h4>
          <p className="ar" style={{ direction: 'inherit' }}>{t('Facts for review, not accusations: high numbers can have innocent reasons.')}</p>
          <table className="list">
            <thead><tr><th>{t('User')}</th><th className="num">{t('Sales')}</th><th className="num">{t('Total')}</th><th className="num">{t('Cash')}</th><th className="num">{t('Card')}</th>
              <th className="num">{t('Discounts')}</th><th className="num">{t('Removed')}</th><th className="num">{t('Reprints')}</th><th className="num">{t('Refunds')}</th><th className="num">{t('Refunds approved')}</th><th className="num">{t('Cash out')}</th><th className="num">{t('Over / short')}</th></tr></thead>
            <tbody>{cashiers.map((c) => (
              <tr key={c.userId}>
                <td>{c.user}</td><td className="num">{c.sales}</td><td className="num">{formatSar(c.salesTotal)}</td><td className="num">{formatSar(c.cashNet)}</td><td className="num">{formatSar(c.card)}</td>
                <td className="num">{c.discountCount} / {formatSar(c.discountTotal)}</td><td className="num">{c.removals} / {formatSar(c.removedValue)}</td><td className="num">{c.reprints}</td>
                <td className="num">{c.refundCount} / {formatSar(c.refundTotal)}</td><td className="num">{c.refundsApproved}</td>
                <td className="num">{c.cashOutCount} / {formatSar(c.cashOutTotal)}</td>
                <td className="num" style={c.overShortTotal < 0 ? { color: 'var(--danger)' } : undefined}>{formatSar(c.overShortTotal)}</td>
              </tr>
            ))}</tbody>
          </table>
          <h4>{t('Refunds ({0})', refunds.length)}</h4>
          <table className="list">
            <thead><tr><th>{t('Time')}</th><th>{t('Credit note')}</th><th>{t('Invoice')}</th><th>{t('Cashier')}</th><th>{t('Approved by')}</th><th>{t('Reason')}</th><th className="num">{t('Items')}</th><th className="num">{t('Back on shelf')}</th><th className="num">{t('Value')}</th></tr></thead>
            <tbody>{refunds.map((x) => <tr key={x.refundId}><td>{new Date(x.at).toLocaleString()}</td><td>{x.refundNo}</td><td>{x.invoiceNo}</td><td>{x.cashier}</td><td>{x.approver}</td><td>{t(x.reason)}</td><td className="num">{x.items}</td><td className="num">{x.restockedItems}</td><td className="num">{formatSar(x.total)}</td></tr>)}</tbody>
          </table>
          <h4>{t('Wastage and stock count differences ({0})', adjustments.length)}</h4>
          <table className="list">
            <thead><tr><th>{t('Time')}</th><th>{t('Document')}</th><th>{t('Type')}</th><th>{t('Reason')}</th><th>{t('User')}</th><th>{t('Product')}</th><th className="num">{t('System qty')}</th><th className="num">{t('Counted')}</th><th className="num">{t('Change')}</th><th className="num">{t('Value')}</th></tr></thead>
            <tbody>{adjustments.map((a, i) => (
              <tr key={i} style={a.value < 0 ? { color: 'var(--danger)' } : undefined}>
                <td>{new Date(a.at).toLocaleString()}</td><td>{a.adjNo}</td><td>{a.kind === 'waste' ? t('Wastage') : t('Stock count')}</td><td>{t(a.reason)}</td><td>{a.user}</td>
                <td>{a.nameEn}</td><td className="num">{formatQty(a.systemQty)}</td><td className="num">{a.countedQty === null ? '—' : formatQty(a.countedQty)}</td><td className="num">{formatQty(a.qty)}</td><td className="num">{formatSar(a.value)}</td>
              </tr>
            ))}</tbody>
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
