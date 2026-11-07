import { useEffect, useRef, useState } from 'react';
import { formatSar, parseQty, parseSar, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import type { Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { AgeingRow, StatementLine, SupplierAccount, UninvoicedGrn } from '../services/purchasing';
import { StatusBadge, StatusLegend } from './StatusBadge';
import { call } from './api';
import { PageHeader } from './PageHeader';
import { useSuggest } from './useSuggest';
import { HelpLink } from './HelpLink';
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
      <PageHeader
        title={t('Purchases')}
        desc={t('Supplier invoices, returns, what the store owes and payments.')}
        actions={
          <div className="seg" role="group" aria-label="purchases section">
            {tabs.filter((x) => x.show).map((x) => (
              <button key={x.id} className={section === x.id ? 'on' : ''} onClick={() => setSection(x.id)}>{t(x.label)}</button>
            ))}
          </div>
        }
      />
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
  const [f, setF] = useState({ no: '', vatNo: '', date: todayDay(), due: '', net: '', vat: '', recoverable: true, reason: '', notes: '', noDue: false, arrangement: '', payNow: '', payMethod: 'bank' as 'bank' | 'till' });
  const payKey = useRef(crypto.randomUUID());
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
        noDueDate: f.noDue || undefined, arrangementNote: f.arrangement || undefined,
        payNow: sar(f.payNow) > 0 ? { requestKey: payKey.current, amount: sar(f.payNow), method: f.payMethod } : undefined,
      });
      payKey.current = crypto.randomUUID();
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
    <div className="card section">
      <h3>{t('Enter a supplier invoice')}</h3>
      <p className="hint">{t('Receive the goods first (Stock tab), then match the receipts to the supplier invoice here.')}</p>
      <label>{t('Supplier')}</label>
      <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
      {supplierId > 0 && (
        <>
          <h4>{t('Goods receipts not yet invoiced')}</h4>
          {grns.length === 0 ? <p>{t('None for this supplier.')}</p> : (
            <table className="list"><tbody>{grns.map((g) => (
              <tr key={g.grnId}>
                <td><input type="checkbox" aria-label={`grn ${g.grnNo}`} checked={picked.includes(g.grnId)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.grnId] : picked.filter((x) => x !== g.grnId))} /></td>
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
                <button type="button" disabled={!(net > 0)} title={t('Suggests 15% of the net. Check it against the invoice.')} onClick={() => setF({ ...f, vat: formatSar(roundDiv(net * 15, 100)) })}>15%</button>
              </div>
            </div>
          </div>
          <label><input type="checkbox" checked={f.recoverable} onChange={(e) => setF({ ...f, recoverable: e.target.checked })} /> {t('Input VAT is recoverable (tax invoice with supplier VAT number)')}</label>
          <p>{t('Goods received (cost): {0} · Invoice net: {1} · Difference: {2}', formatSar(goods), Number.isNaN(net) ? '—' : formatSar(net), formatSar(diff))}</p>
          {diff !== 0 && <><label>{t('Reason for the difference')}</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></>}
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: '0 0 auto' }}><input type="checkbox" checked={f.noDue} onChange={(e) => setF({ ...f, noDue: e.target.checked })} /> {t('No due date (informal credit)')}</label>
            <div style={{ flex: 2 }}><label>{t('Arrangement (e.g. supplier collects at the next delivery)')}</label><input value={f.arrangement} onChange={(e) => setF({ ...f, arrangement: e.target.value })} /></div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label>{t('Paid now (SAR, blank = all on credit)')}</label><input aria-label="paid now" value={f.payNow} onChange={(e) => setF({ ...f, payNow: e.target.value })} /></div>
            <div><label>{t('From')}</label><select value={f.payMethod} onChange={(e) => setF({ ...f, payMethod: e.target.value as 'bank' | 'till' })}><option value="bank">{t('Bank')}</option><option value="till">{t('Till cash (open shift)')}</option></select></div>
          </div>
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
  const [lines, setLines] = useState<{ product: Product; qty: string }[]>([]);
  const [f, setF] = useState({ ref: '', date: todayDay(), reason: '', net: '', vat: '', recoverable: true });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const { items: found } = useSuggest<Product>(search, (q) => call<Product[]>('catalog.search', { text: q }));
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
    <div className="card section">
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
      <label><input type="checkbox" checked={f.recoverable} onChange={(e) => setF({ ...f, recoverable: e.target.checked })} /> {t('The VAT was claimed as input VAT (reverse it)')}</label>
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
      <StatusLegend />
      <table className="list">
        <thead><tr><th>{t('Supplier')}</th><th className="num">{t('Balance owed')}</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.supplierId}><td>{r.supplier}</td><td className="num">{formatSar(r.balance)}{r.balance < 0 ? ` (${t('advance/credit')})` : ''}</td><td><button onClick={() => setOpen(open === r.supplierId ? 0 : r.supplierId)}>{t('Statement')}</button></td></tr>
        ))}</tbody>
      </table>
      {open > 0 && <SupplierItems supplierId={open} />}
      {st && (
        <>
          <h4>{t('Statement: {0}', st.supplier)}</h4>
          <table className="list">
            <thead><tr><th>{t('Date')}</th><th>{t('Document')}</th><th>{t('Reference')}</th><th className="num">{t('Change')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>{st.lines.map((l, i) => <tr key={i}><td>{l.date}</td><td>{l.doc}</td><td>{l.ref}</td><td className="num">{formatSar(l.owedIncrease)}</td><td className="num">{formatSar(l.balance)}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {can('purchase.pay') && <SupplierPay suppliers={suppliers} onDone={(m) => { setMsg(m); void load(); }} />}
      {can('purchase.manage') && (
        <div className="card section">
          <h4>{t('Opening balance (what you owed on day one)')}</h4>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label>{t('Supplier')}</label><SupplierSelect suppliers={suppliers} value={ob.supplierId} onChange={(id) => setOb({ ...ob, supplierId: id })} /></div>
            <div><label>{t('Amount (SAR)')}</label><input value={ob.amount} onChange={(e) => setOb({ ...ob, amount: e.target.value })} /></div>
            <div><label>{t('As of')}</label><input type="date" value={ob.date} onChange={(e) => setOb({ ...ob, date: e.target.value })} /></div>
            <div><label>{t('Reference')}</label><input value={ob.ref} onChange={(e) => setOb({ ...ob, ref: e.target.value })} /></div>
            <button disabled={busy || !ob.supplierId || !(sar(ob.amount) > 0)}
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
  const cols: [keyof AgeingRow, string][] = [['notDue', 'Not due'], ['d1_30', '1–30 days late'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['over90', 'Over 90'], ['noDue', 'No due date'], ['balance', 'Total'], ['advance', 'Advance'], ['returnCredit', 'Return credit']];
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ maxWidth: 220 }}><label>{t('As of')}</label><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <p className="hint">{t('Payments and returns settle the oldest invoices first.')}</p>
      <table className="list">
        <thead><tr><th>{t('Supplier')}</th>{cols.map(([k, l]) => <th key={k} className="num">{t(l)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.supplierId}><td>{r.supplier}</td>{cols.map(([k]) => <td key={k} className={`num${['d1_30', 'd31_60', 'd61_90', 'over90'].includes(k) && (r[k] as number) > 0 ? ' neg' : ''}`}>{formatSar(r[k] as number)}</td>)}</tr>)}
          <tr><td><strong>{t('Total')}</strong></td>{cols.map(([k]) => <td key={k} className="num"><strong>{formatSar(total(k))}</strong></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

type Reg = {
  invoices: { id: number; pinvNo: string; supplier: string; supplierInvoiceNo: string; invoiceDate: string; dueDate: string; goodsNet: number; invoiceNet: number; vat: number; gross: number; differenceReason: string | null }[];
  returns: { id: number; pretNo: string; supplier: string; ref: string | null; returnDate: string; stockValue: number; creditNet: number; vat: number; gross: number; reason: string }[];
  payments: { id: number; payNo: string; supplier: string; amount: number; method: string; paidOn: string; reference: string | null; reason: string | null; reversed: number | null }[];
};

function Register() {
  const { t } = useI18n();
  const [from, setFrom] = useState(`${todayDay().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayDay());
  const [r, setR] = useState<Reg | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  useEffect(() => void call<Reg>('purchase.register', { fromDay: from, toDay: to }).then(setR, () => setR(null)), [from, to, tick]);
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
            <tbody>{r.payments.map((x) => <tr key={x.id}><td>{x.payNo}</td><td>{x.supplier}</td><td>{x.paidOn}</td><td>{x.method === 'till' ? t('Till cash') : t('Bank')}</td><td>{x.reference ?? x.reason}</td><td className={`num${x.amount < 0 ? ' neg' : ''}`}>{formatSar(x.amount)}</td>
              <td>{x.reversed ? <StatusBadge status="reversed" /> : x.amount > 0 && <ReverseButton paymentId={x.id} onDone={reload} />}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}


function ReverseButton({ paymentId, onDone }: { paymentId: number; onDone: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  if (!open) return <button onClick={() => setOpen(true)}>{t('Reverse')}</button>;
  return (
    <span className="row" style={{ display: 'inline-flex', gap: 4 }}>
      <input placeholder={t('Why is this payment being reversed?')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 200 }} />
      <button className="danger" disabled={!reason.trim()} onClick={async () => {
        try {
          await call('purchase.reversePayment', { paymentId, requestKey: crypto.randomUUID(), reason });
          setOpen(false);
          onDone();
        } catch (e) {
          setErr(t((e as Error).message));
        }
      }}>{t('Confirm')}</button>
      {err && <span className="neg">{err}</span>}
    </span>
  );
}

/** Open supplier invoices with total, paid, remaining, due date and status. */
function SupplierItems({ supplierId }: { supplierId: number }) {
  const { t } = useI18n();
  const [a, setA] = useState<SupplierAccount | null>(null);
  useEffect(() => void call<SupplierAccount>('purchase.account', { supplierId }).then(setA, () => setA(null)), [supplierId]);
  if (!a) return null;
  return (
    <div style={{ margin: '8px 0' }}>
      <div className="amounts">
        <div className="kpi"><div className="l">{t('Owed now')}</div><div className="v">{formatSar(a.outstanding)}</div></div>
        <div className="kpi"><div className="l">{t('Overdue')}</div><div className={`v${a.overdue > 0 ? ' neg' : ''}`}>{formatSar(a.overdue)}</div></div>
        <div className="kpi"><div className="l">{t('Paid in advance')}</div><div className="v">{formatSar(a.advance)}</div></div>
        <div className="kpi"><div className="l">{t('Return credit')}</div><div className="v">{formatSar(a.returnCredit)}</div></div>
        <div className="kpi"><div className="l">{t('Total purchases / payments')}</div><div className="v">{formatSar(a.totalPurchases)} / {formatSar(a.totalPayments)}</div></div>
        <div className="kpi"><div className="l">{t('Terms')}</div><div className="v">{t('{0} days', a.paymentTermsDays)}</div></div>
      </div>
      <table className="list">
        <thead><tr><th>{t('Document')}</th><th>{t("Supplier's invoice no.")}</th><th>{t('Date')}</th><th className="num">{t('Total')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Remaining')}</th><th>{t('Due date')}</th><th>{t('Status')}</th></tr></thead>
        <tbody>{a.items.map((i) => (
          <tr key={i.key} title={i.arrangementNote ?? undefined}>
            <td>{i.doc}</td><td>{i.supplierInvoiceNo}</td><td>{i.date}</td><td className="num">{formatSar(i.total)}</td><td className="num">{formatSar(i.total - i.open)}</td>
            <td className="num"><strong>{formatSar(i.open)}</strong></td><td>{i.dueDate ?? t('No due date')}{i.arrangementNote ? ` · ${i.arrangementNote}` : ''}</td><td><StatusBadge status={i.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Pay a supplier: choose which invoices the money settles; anything not allocated is recorded as an advance only when ticked. */
function SupplierPay({ suppliers, onDone }: { suppliers: Supplier[]; onDone: (m: Msg) => void }) {
  const { t } = useI18n();
  const [supplierId, setSupplierId] = useState(0);
  const [acc, setAcc] = useState<SupplierAccount | null>(null);
  const [f, setF] = useState({ amount: '', method: 'bank' as 'bank' | 'till', date: todayDay(), ref: '', advance: false });
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = useRef(crypto.randomUUID());
  const load = (id: number) => (id ? call<SupplierAccount>('purchase.account', { supplierId: id }).then(setAcc, () => setAcc(null)) : setAcc(null));
  useEffect(() => { setAlloc({}); void load(supplierId); }, [supplierId]);
  const open = acc?.items.filter((i) => i.open > 0) ?? [];
  const amt = sar(f.amount);
  const allocated = open.reduce((s, i) => s + (sar(alloc[i.key] ?? '') || 0), 0);
  const leftover = (Number.isNaN(amt) ? 0 : amt) - allocated;
  const bad = Number.isNaN(amt) || allocated > amt || open.some((i) => { const v = sar(alloc[i.key] ?? ''); return Number.isNaN(v) || v < 0 || v > i.open; }) || (leftover > 0 && !f.advance);
  const suggest = () => {
    let left = Number.isNaN(amt) ? 0 : amt;
    setAlloc(Object.fromEntries(open.map((i) => { const a = Math.min(left, i.open); left -= a; return [i.key, a ? formatSar(a) : '']; })));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const allocations = open.map((i) => ({ invoiceId: i.invoiceId ?? undefined, openingId: i.openingId ?? undefined, amount: sar(alloc[i.key] ?? '') || 0 })).filter((x) => x.amount > 0);
      const r = await call<{ payNo: string; advance: number }>('purchase.pay', { requestKey: key.current, supplierId, amount: amt, method: f.method, paidOn: f.date, reference: f.ref || undefined, allocations, allowAdvance: f.advance });
      key.current = crypto.randomUUID();
      setF({ ...f, amount: '', ref: '', advance: false });
      setAlloc({});
      void load(supplierId);
      onDone({ kind: 'ok', text: t('Payment {0} recorded.', r.payNo) + (r.advance > 0 ? ' ' + t('{0} kept as an advance.', formatSar(r.advance)) : '') });
    } catch (e) {
      setErr(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card section" role="group" aria-label="pay supplier" style={{ marginTop: 'var(--sp-4)' }}>
      <h4>{t('Pay a supplier')} <HelpLink article="suppliers-pay" /></h4>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label>{t('Supplier')}</label><SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} /></div>
        <div><label>{t('Amount (SAR)')}</label><input aria-label="supplier pay amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><label>{t('From')}</label><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as 'bank' | 'till' })}><option value="bank">{t('Bank')}</option><option value="till">{t('Till cash (open shift)')}</option></select></div>
        <div><label>{t('Payment date')}</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label>{t('Reference')}</label><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
        <button disabled={!(amt > 0) || open.length === 0} onClick={suggest}>{t('Suggest: oldest first')}</button>
      </div>
      {open.length > 0 && (
        <table className="list">
          <thead><tr><th>{t('Document')}</th><th>{t('Due date')}</th><th className="num">{t('Remaining')}</th><th>{t('Status')}</th><th>{t('Apply')}</th></tr></thead>
          <tbody>{open.map((i) => (
            <tr key={i.key}><td>{i.doc} {i.supplierInvoiceNo}</td><td>{i.dueDate ?? t('No due date')}</td><td className="num">{formatSar(i.open)}</td><td><StatusBadge status={i.status} /></td>
              <td><input aria-label={`apply ${i.doc}`} style={{ width: 110 }} value={alloc[i.key] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.key]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
      )}
      <p>{t('Applied to invoices: {0} · Not applied: {1}', formatSar(allocated), formatSar(Math.max(leftover, 0)))}</p>
      {leftover > 0 && <label><input type="checkbox" checked={f.advance} onChange={(e) => setF({ ...f, advance: e.target.checked })} /> {t('Record the rest as an advance to this supplier')}</label>}
      {err && <p className="msg error">{err}</p>}
      <p><button className="primary" disabled={busy || !supplierId || !(amt > 0) || bad} onClick={save}>{t('Record payment')}</button></p>
    </div>
  );
}
