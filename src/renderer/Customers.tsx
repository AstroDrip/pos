import { useEffect, useRef, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import { storeDateTime } from '../core/store-time';
import type { FinStatus } from '../core/status';
import type { ArAgeingRow, CreditInvoice, CustomerAccount, StatementLine } from '../services/credit';
import { call, type ApiError } from './api';
import { useRemembered, useReturnTick } from './TabHost';
import { validId, validOneOf, validText } from './remember';
import { PageHeader } from './PageHeader';
import { useI18n } from './i18n';
import { useSuggest } from './useSuggest';
import { focusWhenReady, useScreenKeys } from './Keyboard';
import { HelpLink } from './HelpLink';
import { StatusBadge, StatusLegend, statusLabel } from './StatusBadge';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;
const PAGE = 100;
type Found = { id: number; name: string; phone: string | null; creditEnabled: boolean; limit: number | null; outstanding: number; advance: number; available: number | null };
const sar = (s: string) => {
  try {
    return s.trim() ? parseSar(s) : 0;
  } catch {
    return NaN;
  }
};
const FILTERS: (FinStatus | 'all' | 'open')[] = ['all', 'open', 'paid', 'partial', 'unpaid', 'overdue', 'due_soon', 'no_due', 'disputed'];

/** Customer accounts (accounts receivable). Balances come from the records; nothing here is typed in as a total. */
export function Customers({ can, request }: { can: (p: string) => boolean; request?: { id?: number; n: number } }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [text, setText] = useRemembered('customers', 'search', '', validText);
  const [openId, setOpenId] = useRemembered<number | null>('customers', 'openId', null, validId);
  const [view, setView] = useRemembered<'accounts' | 'ageing'>('customers', 'view', 'accounts', validOneOf(['accounts', 'ageing']));
  const [newCust, setNewCust] = useState({ name: '', phone: '' });
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (!request?.n) return;
    if (request.id) setOpenId(request.id);
    focusWhenReady(request.id ? '[aria-label="payment amount"]' : '[data-kb-search="customer"]', '[data-kb-search="customer"]');
  }, [request]);
  // M only opens the place to take a payment. The amount and the save button stay with the cashier.
  useScreenKeys(() => ({
    state: () => ({ unavailable: {} }),
    run: () => focusWhenReady(openId !== null ? '[aria-label="payment amount"]' : '[data-kb-search="customer"]', '[data-kb-search="customer"]'),
  }));
  const { items: found, refresh } = useSuggest<Found>(text, (q) => call<Found[]>('credit.find', { text: q }).catch(() => []), { debounceMs: 250 });
  // With nothing typed, everyone is listed A to Z, one page at a time.
  const browsing = !text.trim();
  const [all, setAll] = useState<{ items: Found[]; total: number }>({ items: [], total: 0 });
  const loadAll = (offset: number) => call<{ items: Found[]; total: number }>('credit.list', { offset, limit: PAGE }).then((r) => setAll((a) => ({ items: offset === 0 ? r.items : [...a.items, ...r.items], total: r.total })), (e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
  useEffect(() => void loadAll(0), [back]);
  const search = () => {
    refresh();
    void loadAll(0);
  };
  const shown = browsing ? all.items : found;

  return (
    <div className="page">
      <PageHeader
        title={t('Customers')}
        desc={t('Credit accounts: what each customer owes, payments, statements.')}
        actions={can('customer.statements') && (
          <div className="seg">
            <button className={view === 'accounts' ? 'on' : ''} onClick={() => setView('accounts')}>{t('Accounts')}</button>
            <button className={view === 'ageing' ? 'on' : ''} onClick={() => setView('ageing')}>{t('Ageing')}</button>
          </div>
        )}
      />
      <div style={{ maxWidth: 520 }}><label>{t('Find a customer (name, phone or ID)')}</label><input aria-label="customer search" data-kb-search="customer" data-kb-suggest value={text} onChange={(e) => setText(e.target.value)} /></div>
      <StatusLegend />
      {view === 'ageing' ? <Ageing onOpen={(id) => { setView('accounts'); setOpenId(id); }} /> : (
        <>
          {browsing && !openId && <p className="hint">{t('Showing {0} of {1}', all.items.length, all.total)}</p>}
          {shown.length > 0 && !(browsing && openId) && (
            <table className="list" aria-label="customers list" style={{ maxWidth: 'var(--section-w)' }}>
              <thead><tr><th>ID</th><th>{t('Name')}</th><th>{t('Phone')}</th><th>{t('Credit')}</th><th className="num">{t('Owed')}</th><th className="num">{t('Advance')}</th><th className="num">{t('Available')}</th></tr></thead>
              <tbody>{shown.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => setOpenId(c.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(c.id)}>
                  <td>{c.id}</td><td>{c.name}</td><td>{c.phone}</td><td>{c.creditEnabled ? t('Yes') : t('No')}</td>
                  <td className="num">{formatSar(c.outstanding)}</td><td className="num">{formatSar(c.advance)}</td>
                  <td className="num">{c.limit === null ? t('No fixed limit') : formatSar(Math.max(c.available ?? 0, 0))}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {browsing && !openId && all.items.length < all.total && <p><button type="button" aria-label="show more customers" onClick={() => void loadAll(all.items.length)}>{t('Show more')}</button></p>}
          {can('customer.manage') && !openId && (
            <div className="row" style={{ maxWidth: 600, alignItems: 'flex-end', marginTop: 8 }}>
              <div><label>{t('New customer name')}</label><input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
              <div><label>{t('Phone')}</label><input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
              <button disabled={!newCust.name.trim()} onClick={async () => {
                try {
                  const id = await call<number>('customer.create', { name: newCust.name, phone: newCust.phone || undefined });
                  setNewCust({ name: '', phone: '' });
                  setOpenId(id);
                } catch (e) {
                  setMsg({ kind: 'error', text: t((e as Error).message) });
                }
              }}>{t('Add customer')}</button>
            </div>
          )}
          {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          {openId !== null && <Account id={openId} can={can} onClose={() => { setOpenId(null); search(); }} />}
        </>
      )}
    </div>
  );
}

function Amount({ l, v, bad, small }: { l: string; v: string; bad?: boolean; small?: boolean }) {
  return <div className="kpi"><div className="l">{l}</div><div className={`v${bad ? ' neg' : ''}${small ? ' sm' : ''}`} title={v}>{v}</div></div>;
}

function Account({ id, can, onClose }: { id: number; can: (p: string) => boolean; onClose: () => void }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [a, setA] = useState<CustomerAccount | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('open');
  const [st, setSt] = useState<{ lines: StatementLine[]; balance: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const load = () => call<CustomerAccount>('credit.account', { customerId: id }).then(setA, (e: ApiError) => (e.code === 'NOT_FOUND' || e.code === 'PERMISSION_DENIED') ? onClose() : setMsg({ kind: 'error', text: t(e.message) }));
  useEffect(() => void load(), [id, back]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      await load();
      if (st) setSt(await call('credit.statement', { customerId: id }));
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  if (!a) return msg ? <p className={`msg ${msg.kind}`}>{msg.text}</p> : null;
  const shown = a.invoices.filter((i) => filter === 'all' || (filter === 'open' ? i.open > 0 : i.status === filter));
  const copyStatement = async () => {
    if (!st) return;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'], ...st.lines.map((l) => [storeDateTime(l.at), l.description, l.ref, formatSar(l.debit), formatSar(l.credit), formatSar(l.balance)])];
    await navigator.clipboard.writeText(rows.map((r) => r.map(q).join(',')).join('\r\n')).then(() => setMsg({ kind: 'ok', text: t('Statement copied. Paste into Excel.') }), () => setMsg({ kind: 'error', text: t('Could not copy to the clipboard') }));
  };

  return (
    <div className="card section" role="region" aria-label="customer account" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{a.name} <small>#{a.id} · {a.phone}</small></h3>
        <button onClick={onClose}>{t('Close')}</button>
      </div>
      <div className="amounts" style={{ marginTop: 8 }}>
        <Amount l={t('Owed now')} v={formatSar(a.outstanding)} />
        <Amount l={t('Overdue')} v={formatSar(a.overdue)} bad={a.overdue > 0} />
        <Amount l={t('Advance held')} v={formatSar(a.advance)} />
        <Amount l={t('Credit limit')} v={!a.creditEnabled ? t('Credit off') : a.creditLimit === null ? t('No fixed limit') : formatSar(a.creditLimit)} />
        <Amount l={t('Available credit')} v={!a.creditEnabled ? '—' : a.available === null ? t('No fixed limit') : formatSar(Math.max(a.available, 0))} />
        <Amount l={t('Terms')} v={a.paymentTermsDays === null ? t('No due date') : t('{0} days', a.paymentTermsDays)} />
        <Amount l={t('Unpaid / partly paid invoices')} v={`${a.unpaidCount} / ${a.partialCount}`} />
        <Amount l={t('Lifetime purchases')} v={formatSar(a.lifetimePurchases)} />
        <Amount l={t('Lifetime payments')} v={formatSar(a.lifetimePayments)} />
        <div className="kpi"><div className="l">{t('Last purchase / payment')}</div>
          <div className="v sm"><span className="line">{a.lastPurchase ? storeDateTime(a.lastPurchase).slice(0, 10) : '—'}</span><span className="line">{a.lastPayment ? storeDateTime(a.lastPayment).slice(0, 10) : '—'}</span></div></div>
      </div>
      {a.notes && <p className="hint">{t('Notes')}: {a.notes}</p>}

      <h4>{t('Credit invoices')}</h4>
      <div className="seg" role="group" aria-label="filter invoices">
        {FILTERS.map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{t(f === 'all' ? 'All' : f === 'open' ? 'Still owed' : statusLabel(f))}</button>)}
      </div>
      <InvoiceTable rows={shown} can={can} busy={busy} onAct={act} />

      {can('customer.payment.record') && <Collect account={a} can={can} onDone={(m) => { setMsg(m); void load(); }} />}
      {a.advance > 0 && can('customer.payment.bank') && a.invoices.some((i) => i.open > 0) && <ApplyAdvance account={a} onDone={(m) => { setMsg(m); void load(); }} />}

      <h4>{t('Payments')}</h4>
      <table className="list">
        <thead><tr><th>{t('Receipt')}</th><th>{t('Date')}</th><th>{t('Method')}</th><th className="num">{t('Amount')}</th><th>{t('Applied to')}</th><th>{t('Recorded by')}</th><th /></tr></thead>
        <tbody>{a.receipts.map((r) => (
          <tr key={r.id}>
            <td>{r.receiptNo}</td><td>{storeDateTime(r.at)}</td><td>{t(r.method)}</td><td className={`num${r.amount < 0 ? ' neg' : ''}`}>{formatSar(r.amount)}</td>
            <td>{r.allocations.map((x) => `${x.invoiceNo}: ${formatSar(x.amount)}`).join(', ') || (r.amount > 0 ? t('Advance') : r.notes)}</td><td>{r.user}</td>
            <td className="actions">
              {r.reversed && <StatusBadge status="reversed" />}
              {r.amount > 0 && <button onClick={() => act(() => call('credit.printReceipt', { receiptId: r.id, copy: true }), t('Receipt printed'))}>{t('Reprint')}</button>}
              {r.amount > 0 && !r.reversed && can('customer.payment.reverse') && <Reason label={t('Reverse')} q={t('Why is this payment being reversed?')} onConfirm={(reason) => act(() => call('credit.reverseReceipt', { receiptId: r.id, requestKey: crypto.randomUUID(), reason }), t('Payment reversed'))} />}
            </td>
          </tr>
        ))}</tbody>
      </table>

      {can('customer.statements') && (
        <>
          <div className="row" style={{ alignItems: 'center', marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>{t('Statement')}</h4>
            <button onClick={async () => setSt(await call('credit.statement', { customerId: id }))}>{st ? t('Refresh') : t('Show statement')}</button>
            {st && <button onClick={copyStatement}>{t('Copy as CSV')}</button>}
          </div>
          {st && (
            <table className="list">
              <thead><tr><th>{t('Date')}</th><th>{t('Description')}</th><th>{t('Reference')}</th><th className="num">{t('Debit (owes more)')}</th><th className="num">{t('Credit (owes less)')}</th><th className="num">{t('Balance')}</th></tr></thead>
              <tbody>{st.lines.map((l, i) => <tr key={i}><td>{storeDateTime(l.at)}</td><td>{t(l.description)}</td><td>{l.ref}</td><td className="num">{l.debit ? formatSar(l.debit) : ''}</td><td className="num">{l.credit ? formatSar(l.credit) : ''}</td><td className="num">{formatSar(l.balance)}</td></tr>)}</tbody>
            </table>
          )}
          {st && st.balance < 0 && <p>{t('A negative balance is an advance the store holds for the customer.')}</p>}
        </>
      )}

      {can('customer.credit.manage') && <Settings account={a} onDone={(m) => { setMsg(m); void load(); }} />}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

function InvoiceTable({ rows, can, busy, onAct }: { rows: CreditInvoice[]; can: (p: string) => boolean; busy: boolean; onAct: (fn: () => Promise<unknown>, ok: string) => void }) {
  const { t } = useI18n();
  return (
    <table className="list">
      <thead><tr><th>{t('Invoice')}</th><th>{t('Date')}</th><th className="num">{t('Total')}</th><th className="num">{t('Paid')}</th><th className="num">{t('Remaining')}</th><th>{t('Due date')}</th><th>{t('Status')}</th><th /></tr></thead>
      <tbody>{rows.map((i) => (
        <tr key={i.saleId}>
          <td>{i.invoiceNo}</td><td>{storeDateTime(i.saleAt).slice(0, 10)}</td><td className="num">{formatSar(i.saleTotal)}</td>
          <td className="num">{formatSar(i.saleTotal - i.open)}</td><td className="num"><strong>{formatSar(i.open)}</strong></td>
          <td>{i.dueDate ?? t('No due date')}</td><td><StatusBadge status={i.status} /></td>
          <td className="actions">
            {i.open > 0 && can('customer.credit.manage') && <Reason label={i.disputed ? t('Clear dispute') : t('Dispute')} q={t('Note')} onConfirm={(note) => onAct(() => call('credit.dispute', { saleId: i.saleId, disputed: !i.disputed, note }), t('Saved'))} />}
            {i.open > 0 && can('customer.writeoff') && !busy && <Reason label={t('Write off')} q={t('Why is this debt being written off? (whole remaining amount)')} onConfirm={(reason) => onAct(() => call('credit.writeOff', { requestKey: crypto.randomUUID(), saleId: i.saleId, amount: i.open, reason }), t('Written off'))} />}
          </td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Small inline "ask for a reason" control (Electron has no window.prompt). */
function Reason({ label, q, onConfirm }: { label: string; q: string; onConfirm: (reason: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) return <button onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
      <input aria-label={q} placeholder={q} value={v} onChange={(e) => setV(e.target.value)} style={{ width: 200 }} />
      <button className="danger" disabled={!v.trim()} onClick={() => { onConfirm(v.trim()); setOpen(false); setV(''); }}>{t('Confirm')}</button>
      <button onClick={() => setOpen(false)}>✕</button>
    </span>
  );
}

function Collect({ account, can, onDone }: { account: CustomerAccount; can: (p: string) => boolean; onDone: (m: Msg) => void }) {
  const { t } = useI18n();
  const open = account.invoices.filter((i) => i.open > 0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'bank'>('cash');
  const [ref, setRef] = useState('');
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const amt = sar(amount);
  const allocated = open.reduce((s, i) => s + (sar(alloc[i.saleId] ?? '') || 0), 0);
  const bad = Number.isNaN(amt) || open.some((i) => { const v = sar(alloc[i.saleId] ?? ''); return Number.isNaN(v) || v > i.open || v < 0; }) || allocated > amt;
  const suggest = async () => {
    if (!(amt > 0)) return;
    const s = await call<{ saleId: number; amount: number }[]>('credit.suggest', { customerId: account.id, amount: amt });
    setAlloc(Object.fromEntries(open.map((i) => [i.saleId, formatSar(s.find((x) => x.saleId === i.saleId)?.amount ?? 0)])));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const allocations = open.map((i) => ({ saleId: i.saleId, amount: sar(alloc[i.saleId] ?? '') || 0 })).filter((x) => x.amount > 0);
      const r = await call<{ receiptId: number; receiptNo: string; advance: number }>('credit.receipt', { requestKey: requestKey.current, customerId: account.id, amount: amt, method, reference: ref || undefined, allocations });
      requestKey.current = crypto.randomUUID();
      setAmount('');
      setAlloc({});
      setRef('');
      call('credit.printReceipt', { receiptId: r.receiptId, copy: false }).catch(() => undefined);
      onDone({ kind: 'ok', text: t('Payment {0} recorded.', r.receiptNo) + (r.advance > 0 ? ' ' + t('{0} kept as an advance.', formatSar(r.advance)) : '') });
    } catch (e) {
      setErr(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="subpanel" role="group" aria-label="collect payment">
      <h4>{t('Receive a payment')} <HelpLink article="customers-receive-payment" /></h4>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label>{t('Amount received (SAR)')}</label><input aria-label="payment amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label>{t('Method')}</label>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">{t('cash')}</option><option value="card">{t('card')}</option>{can('customer.payment.bank') && <option value="bank">{t('bank')}</option>}
          </select>
        </div>
        <div><label>{t('Reference')}</label><input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        <button disabled={!(amt > 0) || open.length === 0} onClick={suggest}>{t('Suggest: oldest first')}</button>
      </div>
      {open.length > 0 && (
        <table className="list">
          <thead><tr><th>{t('Invoice')}</th><th>{t('Due date')}</th><th className="num">{t('Remaining')}</th><th>{t('Apply')}</th></tr></thead>
          <tbody>{open.map((i) => (
            <tr key={i.saleId}><td>{i.invoiceNo} <StatusBadge status={i.status} /></td><td>{i.dueDate ?? t('No due date')}</td><td className="num">{formatSar(i.open)}</td>
              <td><input aria-label={`apply ${i.invoiceNo}`} style={{ width: 110 }} value={alloc[i.saleId] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.saleId]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
      )}
      <p>{t('Applied to invoices: {0} · Kept as advance: {1}', formatSar(allocated), formatSar(Math.max((Number.isNaN(amt) ? 0 : amt) - allocated, 0)))}</p>
      {bad && amount && <p className="msg error">{t('Check the amounts: no more than each invoice owes, and no more than the payment in total.')}</p>}
      {err && <p className="msg error">{err}</p>}
      <p><button className="primary" disabled={busy || bad || !(amt > 0)} onClick={save}>{t('Record payment')}</button></p>
    </div>
  );
}

function ApplyAdvance({ account, onDone }: { account: CustomerAccount; onDone: (m: Msg) => void }) {
  const { t } = useI18n();
  const open = account.invoices.filter((i) => i.open > 0);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const total = open.reduce((s, i) => s + (sar(alloc[i.saleId] ?? '') || 0), 0);
  return (
    <div className="subpanel">
      <h4>{t('Use the advance ({0}) for invoices', formatSar(account.advance))}</h4>
      <table className="list"><tbody>{open.map((i) => (
        <tr key={i.saleId}><td>{i.invoiceNo}</td><td className="num">{formatSar(i.open)}</td>
          <td><input style={{ width: 110 }} value={alloc[i.saleId] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.saleId]: e.target.value })} /></td></tr>
      ))}</tbody></table>
      <p><button disabled={!(total > 0) || total > account.advance} onClick={async () => {
        try {
          await call('credit.applyAdvance', { customerId: account.id, allocations: open.map((i) => ({ saleId: i.saleId, amount: sar(alloc[i.saleId] ?? '') || 0 })).filter((x) => x.amount > 0) });
          setAlloc({});
          onDone({ kind: 'ok', text: t('Advance applied') });
        } catch (e) {
          onDone({ kind: 'error', text: t((e as Error).message) });
        }
      }}>{t('Apply advance')}</button></p>
    </div>
  );
}

function Settings({ account, onDone }: { account: CustomerAccount; onDone: (m: Msg) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    // "No fixed limit" is only pre-ticked when the owner already chose it; a new customer must get a limit typed in.
    enabled: account.creditEnabled, noLimit: account.creditEnabled && account.creditLimit === null, limit: account.creditLimit === null ? '' : formatSar(account.creditLimit),
    noDue: account.paymentTermsDays === null, terms: account.paymentTermsDays === null ? '' : String(account.paymentTermsDays), address: account.address ?? '', notes: account.notes ?? '',
  });
  return (
    <div className="subpanel">
      <h4>{t('Credit settings')}</h4>
      <label><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {t('Allowed to buy on credit')}</label>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label>{t('Credit limit (SAR)')}</label><input disabled={f.noLimit} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /></div>
        <label style={{ flex: '0 0 auto' }}><input type="checkbox" checked={f.noLimit} onChange={(e) => setF({ ...f, noLimit: e.target.checked })} /> {t('No fixed limit (trusted customer)')}</label>
        <div><label>{t('Pay within (days)')}</label><input disabled={f.noDue} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></div>
        <label style={{ flex: '0 0 auto' }}><input type="checkbox" checked={f.noDue} onChange={(e) => setF({ ...f, noDue: e.target.checked })} /> {t('No due date')}</label>
      </div>
      <div className="row">
        <div><label>{t('Address')}</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div><label>{t('Notes')}</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      {f.enabled && !f.noLimit && !f.limit.trim() && <p className="msg warn">{t('Type a credit limit, or tick "No fixed limit" for a trusted customer.')}</p>}
      <p><button className="primary" disabled={f.enabled && !f.noLimit && Number.isNaN(sar(f.limit))} onClick={async () => {
        if (f.enabled && !f.noLimit && !f.limit.trim()) return onDone({ kind: 'error', text: t('Type a credit limit, or tick "No fixed limit" for a trusted customer.') });
        try {
          await call('credit.settings', { customerId: account.id, creditEnabled: f.enabled, creditLimit: f.noLimit ? null : sar(f.limit), paymentTermsDays: f.noDue ? null : Number(f.terms || 0), address: f.address || undefined, notes: f.notes || undefined });
          onDone({ kind: 'ok', text: t('Saved') });
        } catch (e) {
          onDone({ kind: 'error', text: t((e as Error).message) });
        }
      }}>{t('Save credit settings')}</button></p>
    </div>
  );
}

function Ageing({ onOpen }: { onOpen: (id: number) => void }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [rows, setRows] = useState<ArAgeingRow[]>([]);
  useEffect(() => void call<ArAgeingRow[]>('credit.ageing').then(setRows, () => setRows([])), [back]);
  const cols: [keyof ArAgeingRow['buckets'], string][] = [['notDue', 'Not due'], ['d1_30', '1–30 days late'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['over90', 'Over 90'], ['noDue', 'No due date']];
  return (
    <table className="list" style={{ maxWidth: 1100 }}>
      <thead><tr><th>{t('Customer')}</th><th className="num">{t('Owed')}</th>{cols.map(([k, l]) => <th key={k} className="num">{t(l)}</th>)}<th className="num">{t('Advance')}</th><th>{t('Most overdue')}</th><th>{t('Last payment')}</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.customerId} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.customerId)}>
          <td>{r.customer}</td><td className="num"><strong>{formatSar(r.outstanding)}</strong></td>
          {cols.map(([k]) => <td key={k} className={`num${k !== 'notDue' && k !== 'noDue' && r.buckets[k] > 0 ? ' neg' : ''}`}>{formatSar(r.buckets[k])}</td>)}
          <td className="num">{formatSar(r.advance)}</td><td>{r.mostOverdueInvoice ?? '—'}</td><td>{r.lastPayment ? storeDateTime(r.lastPayment).slice(0, 10) : '—'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
