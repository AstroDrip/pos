import { useEffect, useState } from 'react';
import { formatQty, formatSar } from '../core/money';
import { storeDay } from '../core/store-time';
import type { Product } from '../services/catalog';
import type { BillDetail, BillRow, PriceHistoryRow, SupplierPurchases } from '../services/supplier-bills';
import { call } from './api';
import { ProductName, useI18n } from './i18n';
import { useSuggest } from './useSuggest';

const today = () => storeDay(new Date().toISOString());
const monthStart = () => `${today().slice(0, 8)}01`;
const DOC: Record<string, string> = { tax_invoice: 'Tax invoice', delivery_note: 'Delivery note', proforma: 'Proforma invoice', other: 'Other paper' };

function useRange() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { t } = useI18n();
  const fields = (
    <div className="bill-fields noprint">
      <div><label>{t('From')}</label><input type="date" aria-label="from date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div><label>{t('To')}</label><input type="date" aria-label="to date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
    </div>
  );
  return { from, to, fields };
}

/** Saved supplier papers, with every line as it was entered. */
export function SavedBills() {
  const { t } = useI18n();
  const { from, to, fields } = useRange();
  const [rows, setRows] = useState<BillRow[]>([]);
  const [open, setOpen] = useState<BillDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void call<BillRow[]>('bill.list', { fromDay: from, toDay: to }).then((r) => { setRows(r); setError(''); }, (e: Error) => setError(t(e.message))), [from, to]);
  const show = (id: number) => void call<BillDetail>('bill.get', { id }).then(setOpen, (e: Error) => setError(t(e.message)));
  return (
    <div className="card section bill-card">
      <h3 className="noprint">{t('Saved bills')}</h3>
      {fields}
      {error && <p className="msg error">{error}</p>}
      <table className="list noprint" aria-label="saved bills">
        <thead><tr><th>{t('Date')}</th><th>{t('Supplier')}</th><th>{t('Paper type')}</th><th>{t('Number on the paper')}</th><th>{t('The paper says')}</th><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td>{r.docDate}</td><td>{r.supplier}</td><td>{t(DOC[r.docType] ?? 'Other paper')}</td><td>{r.docNo}</td><td>{r.docType === 'delivery_note' ? '—' : r.payType === 'paid' ? t('Paid') : t('Credit')}</td>
            <td className="num">{formatSar(r.net)}</td><td className="num">{formatSar(r.vat)}</td><td className="num">{formatSar(r.total)}</td>
            <td><button type="button" aria-label={`open bill ${r.docNo}`} onClick={() => show(r.id)}>{t('Open')}</button></td>
          </tr>
        ))}</tbody>
      </table>
      {open && (
        <div className="bill-print" role="region" aria-label="bill detail">
          <h4>{open.supplier} · {t(DOC[open.docType] ?? 'Other paper')} {open.docNo}</h4>
          <p>{t('Paper date')}: {open.docDate} · {t('Goods receipt')}: {open.grnNo}{open.pinvNo ? ` · ${t('Invoice')}: ${open.pinvNo}` : ''}{open.salesAgent ? ` · ${t('Sales agent')}: ${open.salesAgent}` : ''}</p>
          <table className="list">
            <thead><tr><th>{t('Code')}</th><th>{t('Item')}</th><th>{t('Pack')}</th><th className="num">{t('Packs')}</th><th className="num">{t('Loose')}</th><th className="num">{t('Free')}</th><th className="num">{t('Received')}</th><th className="num">{t('Price')}</th><th className="num">{t('Discount')}</th><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th></tr></thead>
            <tbody>{open.lines.map((l) => (
              <tr key={l.lineNo}>
                <td>{l.supplierCode}</td><td><ProductName en={l.nameEn} ar={l.nameAr} /></td><td>{l.packName} ({formatQty(l.unitsPerPack, 0)})</td>
                <td className="num">{l.packs}</td><td className="num">{formatQty(l.looseQty, 3)}</td><td className="num">{formatQty(l.freeQty, 3)}</td><td className="num">{formatQty(l.receivedQty, 3)}</td>
                <td className="num">{formatSar(l.price)}</td><td className="num">{formatSar(l.discount)}</td><td className="num">{formatSar(l.net)}</td><td className="num">{formatSar(l.vat)}</td><td className="num">{formatSar(l.total)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="num"><strong>{t('Net')} {formatSar(open.net)} · {t('VAT')} {formatSar(open.vat)} · {t('Total')} {formatSar(open.total)}</strong></p>
          <p className="row noprint"><button type="button" onClick={() => window.print()}>{t('Print')}</button><button type="button" onClick={() => setOpen(null)}>{t('Close')}</button></p>
        </div>
      )}
    </div>
  );
}

/** What each item cost over time, and what was bought from each supplier. */
export function PurchaseReports() {
  const { t } = useI18n();
  const { from, to, fields } = useRange();
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [totals, setTotals] = useState<SupplierPurchases[]>([]);
  const { items: found } = useSuggest<Product>(search, (q) => call<Product[]>('catalog.search', { text: q }));
  useEffect(() => void call<SupplierPurchases[]>('bill.bySupplier', { fromDay: from, toDay: to }).then(setTotals, () => setTotals([])), [from, to]);
  useEffect(() => {
    if (product) void call<PriceHistoryRow[]>('bill.priceHistory', { productId: product.id }).then(setHistory, () => setHistory([]));
  }, [product]);
  return (
    <>
      <div className="card section bill-card">
        <h3>{t('Purchases by supplier')}</h3>
        {fields}
        <table className="list" aria-label="purchases by supplier">
          <thead><tr><th>{t('Supplier')}</th><th className="num">{t('Bills')}</th><th className="num">{t('Gross')}</th><th className="num">{t('Discount')}</th><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th></tr></thead>
          <tbody>{totals.map((r) => <tr key={r.supplierId}><td>{r.supplier}</td><td className="num">{r.bills}</td><td className="num">{formatSar(r.gross)}</td><td className="num">{formatSar(r.discount)}</td><td className="num">{formatSar(r.net)}</td><td className="num">{formatSar(r.vat)}</td><td className="num">{formatSar(r.total)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card section bill-card">
        <h3>{t('Price history')}</h3>
        <label>{t('Add product')}</label>
        <input data-kb-search="product" data-kb-suggest aria-label="price history search" placeholder={t('Search name or SKU')} value={search} onChange={(e) => setSearch(e.target.value)} />
        {found.slice(0, 8).map((p) => <button key={p.id} type="button" style={{ margin: 4 }} onClick={() => { setProduct(p); setSearch(''); }}>{p.nameEn}</button>)}
        {product && (
          <>
            <h4><ProductName en={product.nameEn} ar={product.nameAr} /></h4>
            <table className="list" aria-label="price history">
              <thead><tr><th>{t('Date')}</th><th>{t('Supplier')}</th><th>{t('Number on the paper')}</th><th>{t('Pack')}</th><th className="num">{t('Price')}</th><th className="num">{t('Cost per piece')}</th></tr></thead>
              <tbody>{history.map((h, i) => <tr key={i}><td>{h.docDate}</td><td>{h.supplier}</td><td>{h.docNo}</td><td>{h.packName} ({formatQty(h.unitsPerPack, 0)})</td><td className="num">{formatSar(h.price)}</td><td className="num">{formatSar(h.costPerUnit)}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
