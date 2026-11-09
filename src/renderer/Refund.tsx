import { useEffect, useRef, useState } from 'react';
import { formatQty, formatSar, parseQty, roundDiv } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { RecentSale, RefundableSale, RefundResult } from '../services/refunds';
import { call } from './api';
import { InfoIcon } from './InfoIcon';
import { useReturnTick } from './TabHost';
import { EmptyRow, PageHeader } from './PageHeader';
import { HelpLink } from './HelpLink';
import { ProductName, useI18n } from './i18n';

// Owner policy (D1): receipt required, within the refund window, cash only, supervisor approval for every refund.
const PAGE = 50;
const REASONS = ['Customer changed mind', 'Damaged or faulty', 'Expired', 'Wrong item', 'Other'] as const;

interface Pick {
  qty: string;
  restock: boolean;
}

export function Refund({ canApprove, request }: { canApprove: boolean; request?: { invoice?: string; n: number } }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [invoiceNo, setInvoiceNo] = useState('');
  const [sale, setSale] = useState<RefundableSale | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [reason, setReason] = useState<(typeof REASONS)[number]>(REASONS[0]);
  const [otherReason, setOtherReason] = useState('');
  const [approver, setApprover] = useState({ username: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [lastRefundId, setLastRefundId] = useState<number | null>(null);
  // One key per refund: a retry after an error can never pay out twice.
  const requestKey = useRef(crypto.randomUUID());

  const [recent, setRecent] = useState<{ items: RecentSale[]; total: number }>({ items: [], total: 0 });
  const loadRecent = (offset: number) => call<{ items: RecentSale[]; total: number }>('refund.recent', { offset, limit: PAGE }).then((r) => setRecent((a) => ({ items: offset === 0 ? r.items : [...a.items, ...r.items], total: r.total })), (e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
  useEffect(() => void loadRecent(0), [lastRefundId, back]);

  const find = async (e?: React.FormEvent, no = invoiceNo) => {
    e?.preventDefault();
    setMsg(null);
    setSale(null);
    setPicks({});
    requestKey.current = crypto.randomUUID();
    try {
      const s = await call<RefundableSale>('refund.find', { invoiceNo: no });
      setSale(s);
      setPicks(Object.fromEntries(s.lines.map((l) => [l.saleLineNo, { qty: '', restock: true }])));
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };

  useEffect(() => {
    if (!request?.n || !request.invoice) return;
    setInvoiceNo(request.invoice);
    void find(undefined, request.invoice);
  }, [request]);

  const qtyOf = (lineNo: number) => {
    try {
      const q = (picks[lineNo]?.qty ?? '').trim();
      return q ? parseQty(q) : 0;
    } catch {
      return -1;
    }
  };
  const chosen = sale ? sale.lines.filter((l) => qtyOf(l.saleLineNo) !== 0) : [];
  const invalid = chosen.some((l) => {
    const q = qtyOf(l.saleLineNo);
    return q < 0 || q > l.remainingQty || (l.sellMode === 'unit' && q % 1000 !== 0);
  });
  // Estimate for the cashier; the exact amount is calculated and stored by the app core.
  const estimate = chosen.reduce((s, l) => s + (invalid ? 0 : roundDiv(l.lineIncl * qtyOf(l.saleLineNo), l.soldQty)), 0);
  const reasonText = reason === 'Other' ? otherReason.trim() : reason;

  const submit = async () => {
    if (!sale || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<RefundResult>('refund.create', {
        requestKey: requestKey.current,
        invoiceNo: sale.invoiceNo,
        reason: reasonText,
        lines: chosen.map((l) => ({ saleLineNo: l.saleLineNo, qty: qtyOf(l.saleLineNo), restock: picks[l.saleLineNo]!.restock })),
        approver: canApprove ? undefined : approver,
      });
      setLastRefundId(r.refundId);
      setMsg({ kind: 'ok', text: t('Refund {0} saved. Give the customer {1} in cash.', r.refundNo, formatSar(r.cashOut)) });
      setApprover({ username: '', pin: '' });
      setSale(null);
      setInvoiceNo('');
      requestKey.current = crypto.randomUUID();
      call('refund.print', { refundId: r.refundId, copy: false }).catch((e: Error) =>
        setMsg({ kind: 'warn', text: t('Refund saved, but the credit note did not print: {0}', t(e.message)) }),
      );
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const setPick = (lineNo: number, p: Partial<Pick>) => setPicks({ ...picks, [lineNo]: { ...picks[lineNo]!, ...p } });

  return (
    <div className="page">
      <PageHeader title={t('Refund')} desc={t('Find the sale by its receipt number, choose what comes back, pay the cash.')} actions={<HelpLink article="returns-refund" />} />
      <form className="row" style={{ maxWidth: 520 }} onSubmit={find}>
        <div style={{ flex: 1 }}>
          <label>{t('Invoice number from the receipt')} <InfoIcon id="field.refund.invoice" /></label>
          <input autoFocus data-kb-search="refund" aria-label="refund invoice" placeholder="INV-00000001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </div>
        <button type="submit" style={{ alignSelf: 'flex-end' }} disabled={!invoiceNo.trim()}>{t('Find sale')}</button>
      </form>
      <p style={{ opacity: 0.8 }}>{t('Store policy: receipt required, within {0} days, refunded in cash, supervisor approval.', sale?.maxDays ?? 7)}</p>

      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {lastRefundId !== null && !sale && (
        <p><button onClick={() => call('refund.print', { refundId: lastRefundId, copy: true }).catch((e: Error) => setMsg({ kind: 'error', text: t(e.message) }))}>{t('Reprint last credit note')}</button></p>
      )}

      {!sale && (
        <div>
          <h3>{t('Recent sales')}</h3>
          <p className="hint">{t('Showing {0} of {1}', recent.items.length, recent.total)}</p>
          <table className="list" aria-label="recent sales" style={{ maxWidth: 'var(--section-w)' }}>
            <thead><tr><th>{t('Invoice')}</th><th>{t('Date')}</th><th>{t('Cashier')}</th><th>{t('Customer')}</th><th className="num">{t('Total')}</th><th>{t('Status')}</th></tr></thead>
            <tbody>
              {recent.items.length === 0 && <EmptyRow cols={6} text={t('No sales yet.')} />}
              {recent.items.map((r) => (
                <tr key={r.invoiceNo} style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => { setInvoiceNo(r.invoiceNo); void find(undefined, r.invoiceNo); }} onKeyDown={(e) => { if (e.key === 'Enter') { setInvoiceNo(r.invoiceNo); void find(undefined, r.invoiceNo); } }}>
                  <td dir="ltr">{r.invoiceNo}</td><td>{storeDateTime(r.createdAt)}</td><td>{r.cashier}</td><td>{r.customer ?? ''}</td><td className="num">{formatSar(r.totalIncl)}</td>
                  <td>{r.refunded ? t('Refunded') : r.withinWindow ? '' : t('Past the refund time')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.items.length < recent.total && <p><button type="button" aria-label="show more sales" onClick={() => void loadRecent(recent.items.length)}>{t('Show more')}</button></p>}
        </div>
      )}

      {sale && (
        <div className="card section">
          <h3>{sale.invoiceNo}</h3>
          <p>
            {t('Sold {0} by {1}, total {2}', storeDateTime(sale.createdAt), sale.cashier, formatSar(sale.totalIncl))}
            {' · '}
            {t('{0} days ago', sale.daysSinceSale)}
          </p>
          {sale.refunds.length > 0 && <p className="msg warn">{t('Already refunded on this receipt: {0}', sale.refunds.map((r) => `${r.refundNo} (${formatSar(r.totalIncl)})`).join(', '))}</p>}
          {!sale.withinWindow ? (
            <p className="msg error">{t('This sale is {0} days old. Refunds are allowed within {1} days.', sale.daysSinceSale, sale.maxDays)}</p>
          ) : (
            <>
              {sale.paidByCard > 0 && <p className="msg warn">{t('This sale was paid {0} by card. Store policy: the refund is given in cash.', formatSar(sale.paidByCard))}</p>}
              <h4 className="step-title">{t('1. Choose what comes back')}</h4>
              <table className="list">
                <thead>
                  <tr><th>{t('Item')}</th><th className="num">{t('Sold')}</th><th className="num">{t('Already refunded')}</th><th className="num">{t('Can still refund')}</th><th className="num">{t('Paid')}</th><th>{t('Refund qty')}</th><th>{t('Back on shelf')}</th></tr>
                </thead>
                <tbody>
                  {sale.lines.map((l) => (
                    <tr key={l.saleLineNo} style={l.remainingQty === 0 ? { opacity: 0.5 } : undefined}>
                      <td><ProductName en={l.nameEn} ar={l.nameAr} /></td>
                      <td className="num">{formatQty(l.soldQty, l.sellMode === 'unit' ? 0 : 3)}</td>
                      <td className="num">{formatQty(l.refundedQty, l.sellMode === 'unit' ? 0 : 3)}</td>
                      <td className="num"><strong>{formatQty(l.remainingQty, l.sellMode === 'unit' ? 0 : 3)}</strong></td>
                      <td className="num">{formatSar(l.lineIncl)}</td>
                      <td>
                        {l.remainingQty > 0 && (
                          <span className="row" style={{ gap: 4 }}>
                            <input aria-label={`refund qty ${l.saleLineNo}`} style={{ width: 90 }} value={picks[l.saleLineNo]?.qty ?? ''} onChange={(e) => setPick(l.saleLineNo, { qty: e.target.value })} />
                            <button type="button" onClick={() => setPick(l.saleLineNo, { qty: formatQty(l.remainingQty, l.sellMode === 'unit' ? 0 : 3) })}>{t('All')}</button>
                          </span>
                        )}
                      </td>
                      <td>
                        {l.remainingQty > 0 && (
                          <label title={t('Untick for damaged or expired goods: they are not put back in stock.')}>
                            <input type="checkbox" checked={picks[l.saleLineNo]?.restock ?? true} onChange={(e) => setPick(l.saleLineNo, { restock: e.target.checked })} />
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invalid && <p className="msg error">{t('Check the quantities: no more than what is left, whole units for items sold by piece.')}</p>}

              <h4 className="step-title">{t('2. Why it came back')}</h4>
              <label>{t('Reason')} <InfoIcon id="field.refund.reason" /></label>
              <select value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                {REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
              </select>
              {reason === 'Other' && <input placeholder={t('Describe the reason')} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} />}

              {!canApprove && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span>{t('Refund needs a supervisor:')}</span>
                  <input placeholder={t('Supervisor username')} value={approver.username} onChange={(e) => setApprover({ ...approver, username: e.target.value })} />
                  <input placeholder={t('PIN')} type="password" value={approver.pin} onChange={(e) => setApprover({ ...approver, pin: e.target.value })} />
                </div>
              )}
              <h4 className="step-title">{t('3. Confirm and pay')}</h4>
              <p>
                <button
                  className="primary refund-go"
                  disabled={busy || chosen.length === 0 || invalid || !reasonText || (!canApprove && (!approver.username || !approver.pin))}
                  onClick={submit}
                >
                  {t('Refund about {0} in cash', formatSar(estimate))}
                </button>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
