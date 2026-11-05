import { useEffect, useRef, useState } from 'react';
import { formatSar, parseQty, parseSar, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import type { Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { AgeingRow, StatementLine, UninvoicedGrn } from '../services/purchasing';
import { call } from './api';
import { ProductName, useI18n } from './i18n';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;
const todayDay = () => storeDay(new Date().toISOString());
const sar = (s: string) => {
  try {
    return s.trim() ? parseSar(s) : 0;
  } catch {
    return NaN;
  }
};
type Section = 'invoice' | 'return' | 'pay' | 'ageing' | 'register';

/** Purchasing (plan Phase 4). Posting rules are provisional until the accountant approves. */
export function Purchases({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>(can('purchase.manage') ? 'invoice' : 'pay');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  useEffect(() => void call<Supplier[]>('supplier.list').then(setSuppliers), []);
  const tabs: { id: Section; label: string; show: boolean }[] = [
    { id: 'invoice', label: 'Supplier invoices', show: can('purchase.manage') },
    { id: 'return', label: 'Return to supplier', show: can('purchase.manage') },
    { id: 'pay', label: 'Balances and payments', show: true },
    { id: 'ageing', label: 'Ageing', show: true },
    { id: 'register', label: 'Purchase register', show: true },
  ];
  return (
    <div className="page">
      <div className="row" style={{ maxWidth: 900, flexWrap: 'wrap' }}>
        {tabs.filter((x) => x.show).map((x) => (
          <button key={x.id} className={section === x.id ? 'primary' : ''} onClick={() => setSection(x.id)}>{t(x.label)}</button>
        ))}
      </div>
      <p className="msg warn" style={{ maxWidth: 900 }}>{t('Purchase accounting is provisional until your accountant approves it.')}</p>
      {section === 'invoice' && <InvoiceForm suppliers={suppliers} />}
      {section === 'return' && <ReturnForm suppliers={suppliers} />}
      {section === 'pay' && <Balances suppliers={suppliers} can={can} />}
      {section === 'ageing' && <Ageing />}
      {section === 'register' && <Register />}
    </div>
  );
}

function SupplierSelect({ suppliers, value, onChange }: { suppliers: Supplier[]; value: number; onChange: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <select aria-label="supplier" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>{t('— choose —')}</option>
      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function InvoiceForm({ suppliers }: { suppliers: Supplier[] }) {
  const { t } = useI18n();
  const [supplierId, setSupplierId] = useState(0);
  const [grns, setGrns] = useState<UninvoicedGrn[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [f, setF] = useState({ no: '', vatNo: '', date: todayDay(), due: '', net: '', vat: '', recoverable: true, reason: '', notes: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const load = (id: number) => call<UninvoicedGrn[]>('purchase.uninvoiced', { supplierId: id || undefined }).then(setGrns, () => setGrns([]));
  useEffect(() => {
    setPicked([]);
    const s = suppliers.find((x) => x.id === supplierId);
    setF((p) => ({ ...p, vatNo: s?.vatNumber ?? '' }));
    if (supplierId) void load(supplierId);
    else setGrns([]);
  }, [supplierId]);
  const goods = grns.filter((g) => picked.includes(g.grnId)).reduce((s, g) => s + g.totalCost, 0);
  const net = sar(f.net);
  const vat = sar(f.vat);
  const diff = Number.isNaN(net) ? 0 : net - goods;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ pinvNo: string }>('purchase.invoice', {
        requestKey: requestKey.current, supplierId, supplierInvoiceNo: f.no, supplierVatNo: f.vatNo || undefined, invoiceDate: f.date, dueDate: f.due || undefined,
        grnIds: picked, invoiceNet: net, vatAmount: vat, vatRecoverable: f.recoverable, differenceReason: diff !== 0 ? f.reason : undefined, notes: f.notes || undefined,
      });
      setMsg({ kind: 'ok', text: t('Supplier invoice saved as {0}', r.pinvNo) });
      requestKey.current = crypto.randomUUID();
      setF({ ...f, no: '', net: '', vat: '', reason: '', notes: '' });
      setPicked([]);
      void load(supplierId);
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 820, margin: '8px 0' }}>
      <h3>{t('Enter a supplier invoice')}</h3>
      <p className="ar" style={{ direction: 'inherit' }}>{t('Receive the goods first (Stock tab), then match the receipts to the supplier invoice here.')}</p>
      <label>{t('Supplier')}</label>
      <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
      {supplierId > 0 && (
        <>
          <h4>{t('Goods receipts not yet invoiced')}</h4>
          {grns.length === 0 ? <p>{t('None for this supplier.')}</p> : (
            <table className="list"><tbody>{grns.map((g) => (
              <tr key={g.grnId}>
                <td><input type="checkbox" aria-label={`grn ${g.grnNo}`} style={{ width: 'auto' }} checked={picked.includes(g.grnId)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.grnId] : picked.filter((x) => x !== g.grnId))} /></td>
                <td>{g.grnNo}</td><td>{g.reference}</td><td>{new Date(g.receivedAt).toLocaleDateString()}</td><td className="num">{formatSar(g.totalCost)}</td>
              </tr>
            ))}</tbody></table>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div><label>{t("Supplier's invoice no.")}</label><input aria-label="supplier invoice no" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })} /></div>
            <div><label>{t('Supplier VAT no.')}</label><input value={f.vatNo} onChange={(e) => setF({ ...f, vatNo: e.target.value })} /></div>
            <div><label>{t('Invoice date')}</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div><label>{t('Due date (blank = payment terms)')}</label><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div><label>{t('Net on invoice, excl. VAT (SAR)')}</label><input aria-label="invoice net" value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} /></div>
            <div>
              <label>{t('VAT on invoice (SAR)')}</label>
              <div className="row">
                <input aria-label="invoice vat" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} />
                <button type="button" style={{ flex: '0 0 auto' }} disabled={!(net > 0)} title={t('Suggests 15% of the net. Check it against the invoice.')} onClick={() => setF({ ...f, vat: formatSar(roundDiv(net * 15, 100)) })}>15%</button>
              </div>
            </div>
          </div>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={f.recoverable} onChange={(e) => setF({ ...f, recoverable: e.target.checked })} /> {t('Input VAT is recoverable (tax invoice with supplier VAT number)')}</label>
          <p>{t('Goods received (cost): {0} · Invoice net: {1} · Difference: {2}', formatSar(goods), Number.isNaN(net) ? '—' : formatSar(net), formatSar(diff))}</p>
          {diff !== 0 && <><label>{t('Reason for the difference')}</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></>}
          {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          <p><button className="primary" disabled={busy || picked.length === 0 || !f.no.trim() || !(net > 0) || Number.isNaN(vat)} onClick={save}>{t('Save supplier invoice')}</button></p>
        </>
      )}
    </div>
  );
}

function ReturnForm({ suppliers }: { suppliers: Supplier[] }) {
  const { t } = useI18n();
  const [supplierId, setSupplierId] = useState(0);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<{ product: Product; qty: string }[]>([]);
  const [f, setF] = useState({ ref: '', date: todayDay(), reason: '', net: '', vat: '', recoverable: true });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (search.trim()) void call<Product[]>('catalog.search', { text: search }).then(setFound);
    else setFound([]);
  }, [search]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ pretNo: string; stockValue: number }>('purchase.return', {
        requestKey: requestKey.current, supplierId, supplierCreditRef: f.ref || undefined, returnDate: f.date, reason: f.reason,
        lines: lines.map((l) => ({ productId: l.product.id, qty: parseQty(l.qty) })), creditNet: sar(f.net), vatAmount: sar(f.vat), vatRecoverable: f.recoverable,
      });
      setMsg({ kind: 'ok', text: t('Return saved as {0}. Stock taken out at cost {1}.', r.pretNo, formatSar(r.stockValue)) });
      requestKey.current = crypto.randomUUID();
      setLines([]);
      setF({ ...f, ref: '', reason: '', net: '', vat: '' });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ maxWidth: 820, margin: '8px 0' }}>
      <h3>{t('Return goods to a supplier')}</h3>
      <label>{t('Supplier')}</label>
      <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
      <label>{t('Add product')}</label>
      <input placeholder={t('Search name or SKU')} aria-label="return product search" value={search} onChange={(e) => setSearch(e.target.value)} />
      {found.map((p) => (
        <button key={p.id} style={{ margin: 4 }} onClick={() => { if (!lines.some((l) => l.product.id === p.id)) setLines([...lines, { product: p, qty: '' }]); setSearch(''); }}>{p.nameEn}</button>
      ))}
      <table className="list"><tbody>{lines.map((l, i) => (
        <tr key={l.product.id}>
          <td><ProductName en={l.product.nameEn} ar={l.product.nameAr} /></td>
          <td><input aria-label={`return qty ${i + 1}`} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
          <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
        </tr>
      ))}</tbody></table>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div><label>{t("Supplier's credit note no.")}</label><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
        <div><label>{t('Return date')}</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label>{t('Reason')}</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div><label>{t('Credit net, excl. VAT (SAR)')}</label><input value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} /></div>
        <div><label>{t('VAT on the credit (SAR)')}</label><input value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /></div>
      </div>
      <label><input type="checkbox" style={{ width: 'auto' }} checked={f.recoverable} onChange={(e) => setF({ ...f, recoverable: e.target.checked })} /> {t('The VAT was claimed as input VAT (reverse it)')}</label>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary" disabled={busy || !supplierId || lines.length === 0 || lines.some((l) => !l.qty.trim()) || !f.reason.trim()} onClick={save}>{t('Save return')}</button></p>
    </div>
  );
}

function Balances({ suppliers, can }: { suppliers: Supplier[]; can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<{ supplierId: number; supplier: string; balance: number }[]>([]);
  const [open, setOpen] = useState(0);
  const [st, setSt] = useState<{ supplier: string; lines: StatementLine[]; balance: number } | null>(null);
  const [pay, setPay] = useState({ supplierId: 0, amount: '', method: 'bank' as 'bank' | 'till', date: todayDay(), ref: '' });
  const [ob, setOb] = useState({ supplierId: 0, amount: '', date: todayDay(), ref: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const payKey = useRef(crypto.randomUUID());
  const load = () => call<typeof rows>('purchase.balances').then(setRows, () => setRows([]));
  useEffect(() => void load(), []);
  useEffect(() => {
    if (open) void call<typeof st>('purchase.statement', { supplierId: open }).then(setSt);
    else setSt(null);
  }, [open, rows]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      payKey.current = crypto.randomUUID();
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ maxWidth: 900 }}>
      <h3>{t('What we owe suppliers')}</h3>
      <table className="list">
        <thead><tr><th>{t('Supplier')}</th><th className="num">{t('Balance owed')}</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.supplierId}><td>{r.supplier}</td><td className="num">{formatSar(r.balance)}</td><td><button onClick={() => setOpen(open === r.supplierId ? 0 : r.supplierId)}>{t('Statement')}</button></td></tr>
        ))}</tbody>
      </table>
      {st && (
        <>
          <h4>{t('Statement: {0}', st.supplier)}</h4>
          <table className="list">
            <thead><tr><th>{t('Date')}</th><th>{t('Document')}</th><th>{t('Reference')}</th><th className="num">{t('Change')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>{st.lines.map((l, i) => <tr key={i}><td>{l.date}</td><td>{l.doc}</td><td>{l.ref}</td><td className="num">{formatSar(l.owedIncrease)}</td><td className="num">{formatSar(l.balance)}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {can('purchase.pay') && (
        <div className="card" style={{ maxWidth: 820, margin: '12px 0' }}>
          <h4>{t('Pay a supplier')}</h4>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label>{t('Supplier')}</label><SupplierSelect suppliers={suppliers} value={pay.supplierId} onChange={(id) => setPay({ ...pay, supplierId: id })} /></div>
            <div><label>{t('Amount (SAR)')}</label><input aria-label="supplier pay amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div><label>{t('From')}</label><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as 'bank' | 'till' })}><option value="bank">{t('Bank')}</option><option value="till">{t('Till cash (open shift)')}</option></select></div>
            <div><label>{t('Payment date')}</label><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
            <div><label>{t('Reference')}</label><input value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></div>
            <button className="primary" style={{ flex: '0 0 auto' }} disabled={busy || !pay.supplierId || !(sar(pay.amount) > 0)}
              onClick={() => act(() => call('purchase.pay', { requestKey: payKey.current, supplierId: pay.supplierId, amount: sar(pay.amount), method: pay.method, paidOn: pay.date, reference: pay.ref || undefined }), t('Payment recorded'))}>
              {t('Record payment')}
            </button>
          </div>
        </div>
      )}
      {can('purchase.manage') && (
        <div className="card" style={{ maxWidth: 820, margin: '12px 0' }}>
          <h4>{t('Opening balance (what you owed on day one)')}</h4>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label>{t('Supplier')}</label><SupplierSelect suppliers={suppliers} value={ob.supplierId} onChange={(id) => setOb({ ...ob, supplierId: id })} /></div>
            <div><label>{t('Amount (SAR)')}</label><input value={ob.amount} onChange={(e) => setOb({ ...ob, amount: e.target.value })} /></div>
            <div><label>{t('As of')}</label><input type="date" value={ob.date} onChange={(e) => setOb({ ...ob, date: e.target.value })} /></div>
            <div><label>{t('Reference')}</label><input value={ob.ref} onChange={(e) => setOb({ ...ob, ref: e.target.value })} /></div>
            <button style={{ flex: '0 0 auto' }} disabled={busy || !ob.supplierId || !(sar(ob.amount) > 0)}
              onClick={() => act(() => call('purchase.opening', { supplierId: ob.supplierId, amount: sar(ob.amount), asOf: ob.date, reference: ob.ref || undefined }), t('Opening balance saved'))}>
              {t('Save opening balance')}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

function Ageing() {
  const { t } = useI18n();
  const [asOf, setAsOf] = useState(todayDay());
  const [rows, setRows] = useState<AgeingRow[]>([]);
  useEffect(() => void call<AgeingRow[]>('purchase.ageing', { asOf }).then(setRows, () => setRows([])), [asOf]);
  const total = (k: keyof AgeingRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const cols: [keyof AgeingRow, string][] = [['notDue', 'Not due'], ['d1_30', '1–30 days late'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['over90', 'Over 90'], ['balance', 'Total']];
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ maxWidth: 220 }}><label>{t('As of')}</label><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <p className="ar" style={{ direction: 'inherit' }}>{t('Payments and returns settle the oldest invoices first.')}</p>
      <table className="list">
        <thead><tr><th>{t('Supplier')}</th>{cols.map(([k, l]) => <th key={k} className="num">{t(l)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.supplierId}><td>{r.supplier}</td>{cols.map(([k]) => <td key={k} className={`num${k !== 'notDue' && k !== 'balance' && (r[k] as number) > 0 ? ' neg' : ''}`}>{formatSar(r[k] as number)}</td>)}</tr>)}
          <tr><td><strong>{t('Total')}</strong></td>{cols.map(([k]) => <td key={k} className="num"><strong>{formatSar(total(k))}</strong></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

type Reg = {
  invoices: { id: number; pinvNo: string; supplier: string; supplierInvoiceNo: string; invoiceDate: string; dueDate: string; goodsNet: number; invoiceNet: number; vat: number; gross: number; differenceReason: string | null }[];
  returns: { id: number; pretNo: string; supplier: string; ref: string | null; returnDate: string; stockValue: number; creditNet: number; vat: number; gross: number; reason: string }[];
  payments: { id: number; payNo: string; supplier: string; amount: number; method: string; paidOn: string; reference: string | null; reason: string | null }[];
};

function Register() {
  const { t } = useI18n();
  const [from, setFrom] = useState(`${todayDay().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayDay());
  const [r, setR] = useState<Reg | null>(null);
  useEffect(() => void call<Reg>('purchase.register', { fromDay: from, toDay: to }).then(setR, () => setR(null)), [from, to]);
  return (
    <div>
      <div className="row" style={{ maxWidth: 420 }}>
        <div><label>{t('From')}</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>{t('To')}</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {r && (
        <>
          <h4>{t('Supplier invoices ({0})', r.invoices.length)}</h4>
          <table className="list">
            <thead><tr><th>{t('No.')}</th><th>{t('Supplier')}</th><th>{t("Supplier's invoice no.")}</th><th>{t('Date')}</th><th>{t('Due date')}</th><th className="num">{t('Goods received')}</th><th className="num">{t('Net')}</th><th className="num">{t('VAT')}</th><th className="num">{t('Total')}</th></tr></thead>
            <tbody>{r.invoices.map((i) => <tr key={i.id} title={i.differenceReason ?? undefined}><td>{i.pinvNo}</td><td>{i.supplier}</td><td>{i.supplierInvoiceNo}</td><td>{i.invoiceDate}</td><td>{i.dueDate}</td><td className="num">{formatSar(i.goodsNet)}</td><td className="num">{formatSar(i.invoiceNet)}</td><td className="num">{formatSar(i.vat)}</td><td className="num">{formatSar(i.gross)}</td></tr>)}</tbody>
          </table>
          <h4>{t('Returns to suppliers ({0})', r.returns.length)}</h4>
          <table className="list">
            <tbody>{r.returns.map((x) => <tr key={x.id}><td>{x.pretNo}</td><td>{x.supplier}</td><td>{x.returnDate}</td><td>{x.reason}</td><td className="num">{formatSar(x.stockValue)}</td><td className="num">{formatSar(x.gross)}</td></tr>)}</tbody>
          </table>
          <h4>{t('Supplier payments ({0})', r.payments.length)}</h4>
          <table className="list">
            <tbody>{r.payments.map((x) => <tr key={x.id}><td>{x.payNo}</td><td>{x.supplier}</td><td>{x.paidOn}</td><td>{x.method === 'till' ? t('Till cash') : t('Bank')}</td><td>{x.reference ?? x.reason}</td><td className={`num${x.amount < 0 ? ' neg' : ''}`}>{formatSar(x.amount)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

