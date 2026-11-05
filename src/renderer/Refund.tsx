import { useRef, useState } from 'react';
import { formatQty, formatSar, parseQty, roundDiv } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { RefundableSale, RefundResult } from '../services/refunds';
import { call } from './api';
import { PageHeader } from './PageHeader';
import { ProductName, useI18n } from './i18n';

// Owner policy (D1): receipt required, within the refund window, cash only, supervisor approval for every refund.
const REASONS = ['Customer changed mind', 'Damaged or faulty', 'Expired', 'Wrong item', 'Other'] as const;

interface Pick {
  qty: string;
  restock: boolean;
}

export function Refund({ canApprove }: { canApprove: boolean }) {
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

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg(null);
    setSale(null);
    setPicks({});
    requestKey.current = crypto.randomUUID();
    try {
      const s = await call<RefundableSale>('refund.find', { invoiceNo });
      setSale(s);
      setPicks(Object.fromEntries(s.lines.map((l) => [l.saleLineNo, { qty: '', restock: true }])));
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };

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
      <PageHeader title={t('Refund')} desc={t('Find the sale by its receipt number, choose what comes back, pay the cash.')} />
      <form className="row" style={{ maxWidth: 520 }} onSubmit={find}>
        <div style={{ flex: 1 }}>
          <label>{t('Invoice number from the receipt')}</label>
          <input autoFocus aria-label="refund invoice" placeholder="INV-00000001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </div>
        <button type="submit" style={{ alignSelf: 'flex-end' }} disabled={!invoiceNo.trim()}>{t('Find sale')}</button>
      </form>
      <p style={{ opacity: 0.8 }}>{t('Store policy: receipt required, within {0} days, refunded in cash, supervisor approval.', sale?.maxDays ?? 7)}</p>

      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {lastRefundId !== null && !sale && (
        <p><button onClick={() => call('refund.print', { refundId: lastRefundId, copy: true }).catch((e: Error) => setMsg({ kind: 'error', text: t(e.message) }))}>{t('Reprint last credit note')}</button></p>
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
              <table className="list">
                <thead>
                  <tr><th>{t('Item')}</th><th className="num">{t('Sold')}</th><th className="num">{t('Already refunded')}</th><th className="num">{t('Paid')}</th><th>{t('Refund qty')}</th><th>{t('Back on shelf')}</th></tr>
                </thead>
                <tbody>
                  {sale.lines.map((l) => (
                    <tr key={l.saleLineNo} style={l.remainingQty === 0 ? { opacity: 0.5 } : undefined}>
                      <td><ProductName en={l.nameEn} ar={l.nameAr} /></td>
                      <td className="num">{formatQty(l.soldQty, l.sellMode === 'unit' ? 0 : 3)}</td>
                      <td className="num">{formatQty(l.refundedQty, l.sellMode === 'unit' ? 0 : 3)}</td>
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

              <label>{t('Reason')}</label>
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
              <p>
                <button
                  className="primary"
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
