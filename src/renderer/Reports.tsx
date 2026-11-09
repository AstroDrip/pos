import { useEffect, useState } from 'react';
import { formatMoney, formatQty, formatSar } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { AdjustmentRow, CashierActivity, RefundRow, SalesSummary, VoidRow } from '../services/reports';
import { call } from './api';
import { DateNavigator, useDateRange } from './DateNavigator';
import { Kpi, Views } from './Figures';
import { SalesChart } from './SalesChart';
import { InfoIcon } from './InfoIcon';
import { useRemembered, useReturnTick } from './TabHost';
import { validOneOf } from './remember';
import { EmptyRow, PageHeader } from './PageHeader';
import { useI18n } from './i18n';

const VIEWS = ['sales', 'cashiers', 'refunds', 'stock', 'removed'] as const;
type View = (typeof VIEWS)[number];

export function Reports() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [dates, setDates] = useDateRange('reports', 'today');
  const [view, setView] = useRemembered<View>('reports', 'view', 'sales', validOneOf(VIEWS));
  const [r, setR] = useState<SalesSummary | null>(null);
  const [voids, setVoids] = useState<VoidRow[]>([]);
  const [cashiers, setCashiers] = useState<CashierActivity[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [openCashier, setOpenCashier] = useState<number | null>(null);
  const [error, setError] = useState('');
  const { from, to } = dates;

  useEffect(() => {
    // Days are Saudi-time business days (UTC+3); the main process converts them.
    setError('');
    call<SalesSummary>('report.sales', { fromDay: from, toDay: to }).then(setR, (e: Error) => setError(e.message));
    call<VoidRow[]>('report.voids', { fromDay: from, toDay: to }).then(setVoids, () => setVoids([]));
    call<CashierActivity[]>('report.cashiers', { fromDay: from, toDay: to }).then(setCashiers, () => setCashiers([]));
    call<RefundRow[]>('report.refunds', { fromDay: from, toDay: to }).then(setRefunds, () => setRefunds([]));
    call<AdjustmentRow[]>('report.adjustments', { fromDay: from, toDay: to }).then(setAdjustments, () => setAdjustments([]));
  }, [from, to, back]);

  return (
    <div className="page">
      <PageHeader title={t('Reports')} desc={t('Sales, refunds, cashiers and stock changes for any dates (Saudi time).')} />
      <DateNavigator name="Reports" value={dates} onChange={setDates} />
      {error && <p className="msg error">{error}</p>}
      {r && (
        <>
          <div className="kpis" aria-label="key figures">
            <Kpi lead l={t('Net sales incl. VAT')} info="metric.report.netIncl" v={formatMoney(r.netIncl)} sub={t('After {0} refunds', r.refundCount)} />
            <Kpi l={t('Sales')} info="metric.report.count" v={String(r.saleCount)} />
            <Kpi l={t('Cash (net of change)')} info="metric.report.cash" v={formatMoney(r.cash)} sub={t('Before refunds')} />
            <Kpi l={t('Card')} info="metric.report.card" v={formatMoney(r.card)} />
          </div>
          <SalesChart dates={dates} onDates={setDates} tick={back} />
          <details className="more">
            <summary>{t('VAT, discounts and refunds')}</summary>
            <table className="list" style={{ maxWidth: 480 }}>
              <tbody>
                <tr><td>{t('Total incl. VAT')} <InfoIcon id="metric.report.incl" /></td><td className="num">{formatSar(r.totalIncl)}</td></tr>
                <tr><td>{t('VAT')} <InfoIcon id="metric.report.vat" /></td><td className="num">{formatSar(r.totalVat)}</td></tr>
                <tr><td>{t('Total excl. VAT')} <InfoIcon id="metric.report.excl" /></td><td className="num">{formatSar(r.totalExcl)}</td></tr>
                <tr><td>{t('Discounts given')} <InfoIcon id="metric.report.discounts" /></td><td className="num">{formatSar(r.totalDiscount)}</td></tr>
                <tr><td>{t('Refunds ({0}, paid in cash)', r.refundCount)} <InfoIcon id="metric.refundsIncl" /></td><td className="num">-{formatSar(r.refundTotal)}</td></tr>
                <tr><td>{t('Net VAT')} <InfoIcon id="metric.report.netVat" /></td><td className="num">{formatSar(r.netVat)}</td></tr>
              </tbody>
            </table>
          </details>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <Views name="report view" value={view} onChange={setView} options={[
              { id: 'sales', label: t('Sales and products') },
              { id: 'cashiers', label: t('Cashiers') },
              { id: 'refunds', label: t('Refunds ({0})', refunds.length) },
              { id: 'stock', label: t('Stock changes ({0})', adjustments.length) },
              { id: 'removed', label: t('Removed items ({0})', voids.length) },
            ]} />
          </div>
          {view === 'sales' && (
            <>
              <h4 style={{ marginTop: 0 }}>{t('By day')}</h4>
              <table className="list">
                <thead><tr><th>{t('Day')}</th><th className="num">{t('Sales')} <InfoIcon id="metric.report.count" /></th><th className="num">{t('Total')}</th><th className="num">{t('VAT')} <InfoIcon id="metric.report.vat" /></th></tr></thead>
                <tbody>{r.byDay.length === 0 && <EmptyRow cols={4} text={t('No sales in these dates.')} />}{r.byDay.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.saleCount}</td><td className="num">{formatSar(d.totalIncl)}</td><td className="num">{formatSar(d.totalVat)}</td></tr>)}</tbody>
              </table>
              <h4>{t('Top products')}</h4>
              <table className="list">
                <thead><tr><th>{t('Product')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Total')}</th></tr></thead>
                <tbody>{r.topProducts.length === 0 && <EmptyRow cols={3} text={t('No sales in these dates.')} />}{r.topProducts.map((p) => <tr key={p.productId}><td>{p.nameEn}</td><td className="num">{formatQty(p.qty)}</td><td className="num">{formatSar(p.totalIncl)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {view === 'cashiers' && (
            <>
              <p className="hint">{t('Facts for review, not accusations: high numbers can have innocent reasons.')}</p>
              <table className="list" aria-label="cashier activity">
                <thead><tr><th>{t('User')}</th><th className="num">{t('Sales')} <InfoIcon id="metric.report.count" /></th><th className="num">{t('Total')}</th><th className="num">{t('Cash')}</th><th className="num">{t('Card')} <InfoIcon id="metric.report.card" /></th><th className="num">{t('Over / short')}</th><th /></tr></thead>
                <tbody>{cashiers.length === 0 && <EmptyRow cols={7} text={t('No activity in these dates.')} />}{cashiers.flatMap((c) => [
                  <tr key={c.userId}>
                    <td>{c.user}</td><td className="num">{c.sales}</td><td className="num">{formatSar(c.salesTotal)}</td><td className="num">{formatSar(c.cashNet)}</td><td className="num">{formatSar(c.card)}</td>
                    <td className={`num${c.overShortTotal < 0 ? ' neg' : ''}`}>{formatSar(c.overShortTotal)}</td>
                    <td className="actions"><button type="button" aria-expanded={openCashier === c.userId} onClick={() => setOpenCashier(openCashier === c.userId ? null : c.userId)}>{openCashier === c.userId ? t('Less') : t('More')}</button></td>
                  </tr>,
                  ...(openCashier === c.userId ? [
                    <tr key={`${c.userId}-more`} className="row-more"><td colSpan={7}>
                      <div className="pairs">
                        <div><span className="k">{t('Discounts')}</span><span>{c.discountCount} / {formatSar(c.discountTotal)}</span></div>
                        <div><span className="k">{t('Removed')}</span><span>{c.removals} / {formatSar(c.removedValue)}</span></div>
                        <div><span className="k">{t('Reprints')}</span><span>{c.reprints}</span></div>
                        <div><span className="k">{t('Refunds')}</span><span>{c.refundCount} / {formatSar(c.refundTotal)}</span></div>
                        <div><span className="k">{t('Refunds approved')}</span><span>{c.refundsApproved}</span></div>
                        <div><span className="k">{t('Cash out')}</span><span>{c.cashOutCount} / {formatSar(c.cashOutTotal)}</span></div>
                      </div>
                    </td></tr>,
                  ] : []),
                ])}</tbody>
              </table>
            </>
          )}
          {view === 'refunds' && (
            <table className="list">
              <thead><tr><th>{t('Time')}</th><th>{t('Credit note')}</th><th>{t('Invoice')}</th><th>{t('Cashier')}</th><th>{t('Approved by')}</th><th>{t('Reason')}</th><th className="num">{t('Items')}</th><th className="num">{t('Back on shelf')}</th><th className="num">{t('Value')}</th></tr></thead>
              <tbody>{refunds.length === 0 && <EmptyRow cols={9} text={t('No refunds in these dates.')} />}{refunds.map((x) => <tr key={x.refundId}><td>{storeDateTime(x.at)}</td><td>{x.refundNo}</td><td>{x.invoiceNo}</td><td>{x.cashier}</td><td>{x.approver}</td><td>{t(x.reason)}</td><td className="num">{x.items}</td><td className="num">{x.restockedItems}</td><td className="num">{formatSar(x.total)}</td></tr>)}</tbody>
            </table>
          )}
          {view === 'stock' && (
            <table className="list">
              <thead><tr><th>{t('Time')}</th><th>{t('Document')}</th><th>{t('Type')}</th><th>{t('Reason')}</th><th>{t('User')}</th><th>{t('Product')}</th><th className="num">{t('System qty')}</th><th className="num">{t('Counted')}</th><th className="num">{t('Change')}</th><th className="num">{t('Value')}</th></tr></thead>
              <tbody>{adjustments.length === 0 && <EmptyRow cols={10} text={t('No wastage or count differences in these dates.')} />}{adjustments.map((a, i) => (
                <tr key={i}>
                  <td>{storeDateTime(a.at)}</td><td>{a.adjNo}</td><td>{a.kind === 'waste' ? t('Wastage') : t('Stock count')}</td><td>{t(a.reason)}</td><td>{a.user}</td>
                  <td>{a.nameEn}</td><td className="num">{formatQty(a.systemQty)}</td><td className="num">{a.countedQty === null ? '—' : formatQty(a.countedQty)}</td><td className="num">{formatQty(a.qty)}</td><td className={`num${a.value < 0 ? ' neg' : ''}`}>{formatSar(a.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {view === 'removed' && (
            <table className="list">
              <thead><tr><th>{t('Time')}</th><th>{t('User')}</th><th>{t('Invoice')}</th><th>{t('Type')}</th><th className="num">{t('Items')}</th><th className="num">{t('Value')}</th></tr></thead>
              <tbody>{voids.length === 0 && <EmptyRow cols={6} text={t('Nothing was removed from a bill in these dates.')} />}{voids.map((v, i) => <tr key={i}><td>{storeDateTime(v.at)}</td><td>{v.user}</td><td>{v.invoiceNo ?? t('Not paid')}</td><td>{v.kind === 'bill_cleared' ? t('Bill cleared') : t('Line removed')}</td><td className="num">{v.items}</td><td className="num">{formatSar(v.total)}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
