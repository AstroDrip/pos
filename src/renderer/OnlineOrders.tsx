import { useEffect, useState } from 'react';
import { formatQty, formatSar, parseQty, parseSar } from '../core/money';
import { computeInvoice } from '../core/vat';
import { storeDateTime } from '../core/store-time';
import type { OnlineOrderView } from '../services/commerce-orders';
import type { SaleResult } from '../services/sales';
import { call } from './api';
import { InfoIcon } from './InfoIcon';
import { PageHeader } from './PageHeader';
import { useReturnTick } from './TabHost';
import { useI18n } from './i18n';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

const STATUS: Record<OnlineOrderView['status'], string> = { waiting: 'Waiting', handed_over: 'Handed over', cancelled: 'Cancelled online' };

/** Accepted online orders, handed over at the counter as a normal sale. Prices, VAT and stock work exactly as in Sell. */
export function OnlineOrders() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [orders, setOrders] = useState<OnlineOrderView[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SaleResult | null>(null);

  const load = () => call<OnlineOrderView[]>('online.list', null).then(setOrders).catch((e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000); // new orders arrive with the online store sync
    return () => clearInterval(timer);
  }, [back]);

  const order = orders.find((o) => o.orderId === chosen) ?? null;
  const pick = (o: OnlineOrderView) => {
    setChosen(o.orderId);
    setQtys(Object.fromEntries(o.lines.map((l) => [l.productId, formatQty(l.qty, l.sellMode === 'weight' ? 3 : 0)])));
    setCash('');
    setCard('');
    setMsg(null);
    setPriceChanged(false);
    setDone(null);
  };

  const lines = order ? order.lines.map((l) => {
    let q = 0;
    try {
      q = parseQty(qtys[l.productId] ?? '0');
    } catch {
      q = -1;
    }
    return { ...l, take: q };
  }) : [];
  const bad = lines.some((l) => l.take < 0 || (l.sellMode === 'unit' && l.take % 1000 !== 0) || (!l.isEstimate && l.take > l.qty));
  const selling = lines.filter((l) => l.take > 0);
  const total = selling.length ? computeInvoice(selling.map((l) => ({ unitPriceIncl: l.priceNow, qty: l.take, discount: 0, vatRate: l.vatRateBp }))).totalIncl : 0;
  const money = (s: string) => {
    try {
      return s.trim() ? parseSar(s) : 0;
    } catch {
      return -1;
    }
  };
  const paid = money(cash) + money(card);
  const enough = money(cash) >= 0 && money(card) >= 0 && money(card) <= total && paid >= total;

  const handOver = async (useCurrentPrices: boolean) => {
    if (!order) return;
    setBusy(true);
    setMsg(null);
    try {
      const payments = [...(money(cash) > 0 ? [{ tender: 'cash', amount: money(cash) }] : []), ...(money(card) > 0 ? [{ tender: 'card', amount: money(card) }] : [])];
      const r = await call<SaleResult>('online.handover', { orderId: order.orderId, lines: selling.map((l) => ({ productId: l.productId, qty: l.take })), payments, useCurrentPrices });
      setDone(r);
      setMsg({ kind: 'ok', text: t('Handed over. Invoice {0}. Change {1}.', r.invoiceNo, formatSar(r.changeGiven)) });
      await call('sale.print', { saleId: r.saleId, copy: false }).catch(() => setMsg({ kind: 'warn', text: t('Handed over, but the receipt did not print. Reprint it from Sell.') }));
      await load();
    } catch (e) {
      const text = (e as Error).message;
      setPriceChanged(/changed from/.test(text));
      setMsg({ kind: 'error', text: t(text) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('Online orders')} desc={t('Orders accepted on the website. Hand them over here as a normal sale.')} />
      <div className="grid-cards">
        <div className="card section">
          <h3>{t('Orders')}</h3>
          {orders.length === 0 ? <p className="muted">{t('No online orders waiting.')}</p> : (
            <table className="list" aria-label="online orders">
              <thead><tr><th>{t('Order')}</th><th>{t('Customer')}</th><th>{t('Received')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>{orders.map((o) => (
                <tr key={o.orderId}>
                  <td><button aria-pressed={o.orderId === chosen} onClick={() => pick(o)}>{o.orderId === chosen ? <strong>{o.publicRef}</strong> : o.publicRef}</button></td>
                  <td>{o.customerName}</td>
                  <td>{storeDateTime(o.receivedAt)}</td>
                  <td>{t(STATUS[o.status])}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {order && (
          <div className="card section">
            <h3>{order.publicRef} · {order.customerName}</h3>
            <p className="muted">{order.phone} · {order.fulfilment === 'pickup' ? t('Store pickup') : t('Delivery')}</p>
            {order.status === 'cancelled' && <p className="msg error">{t('Cancelled online: {0}. Do not hand it over.', order.cancelReason ?? '')}</p>}
            {order.status === 'handed_over' && <p className="msg ok">{t('Handed over. Invoice {0}.', order.invoiceNo ?? '')}</p>}
            {order.status === 'waiting' && (
              <>
                <table className="list" aria-label="order items">
                  <thead><tr><th>{t('Item')}</th><th className="num">{t('Ordered')}</th><th className="num">{t('Handing over')} <InfoIcon id="field.online.qty" /></th><th className="num">{t('Price')}</th></tr></thead>
                  <tbody>{lines.map((l) => (
                    <tr key={l.productId}>
                      <td>{l.name}{l.priceNow !== l.unitPriceIncl && <span className="msg warn"> {t('Price now {0}, ordered at {1}', formatSar(l.priceNow), formatSar(l.unitPriceIncl))}</span>}</td>
                      <td className="num">{formatQty(l.qty, l.sellMode === 'weight' ? 3 : 0)}</td>
                      <td className="num"><input aria-label={`hand over ${l.name}`} className="num" value={qtys[l.productId] ?? ''} onChange={(e) => setQtys({ ...qtys, [l.productId]: e.target.value })} /></td>
                      <td className="num">{formatSar(l.priceNow)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="muted">{t('Weighed items: enter the weight on the label. An item the customer does not take: enter 0.')}</p>
                {bad && <p className="msg error">{t('Check the amounts. Pieces must be whole, and no more than ordered.')}</p>}
                <p><strong>{t('Total')} {formatSar(total)}</strong></p>
                <div className="form-grid">
                  <div><label>{t('Cash received')} <InfoIcon id="field.pay.cash" /></label><input value={cash} onChange={(e) => setCash(e.target.value)} /></div>
                  <div><label>{t('Card part of a split payment')} <InfoIcon id="field.pay.card" /></label><input value={card} onChange={(e) => setCard(e.target.value)} /></div>
                </div>
                <p>
                  <button className="primary" disabled={busy || bad || selling.length === 0 || !enough || done !== null} onClick={() => void handOver(false)}>{t('Hand over and sell')}</button>
                  {priceChanged && <button disabled={busy} onClick={() => void handOver(true)}>{t("Sell at today's price")}</button>}
                </p>
              </>
            )}
            {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
