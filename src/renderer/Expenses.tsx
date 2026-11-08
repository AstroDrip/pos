import { useEffect, useRef, useState } from 'react';
import { formatSar, parseSar, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import type { ExpenseCategory, ExpenseRow, ExpenseSummary, PayMethod, VatClass } from '../services/expenses';
import { call } from './api';
import { EmptyRow, PageHeader } from './PageHeader';
import { useI18n } from './i18n';
import { HelpLink } from './HelpLink';
import { StatusBadge } from './StatusBadge';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;
const todayDay = () => storeDay(new Date().toISOString());
const monthRange = (offset: number): [string, string] => {
  const d = new Date(`${todayDay().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const start = d.toISOString().slice(0, 10);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return [start, d.toISOString().slice(0, 10)];
};
const sarOrZero = (s: string) => {
  try {
    return s.trim() ? parseSar(s) : 0;
  } catch {
    return NaN;
  }
};
const STATES = ['draft', 'unpaid', 'partial', 'overdue', 'paid', 'cancelled', 'reversed'];
const VAT: VatClass[] = ['standard', 'zero', 'exempt', 'out_of_scope'];
const VAT_LABEL: Record<VatClass, string> = { standard: 'Standard-rated (15%)', zero: 'Zero-rated', exempt: 'Exempt', out_of_scope: 'Out of scope / no VAT' };

export function Expenses({ can }: { can: (p: string) => boolean }) {
  const { t, lang } = useI18n();
  const [range, setRange] = useState<[string, string]>(monthRange(0));
  const [preset, setPreset] = useState<'this' | 'prev' | 'custom'>('this');
  const [filter, setFilter] = useState({ categoryId: 0, payState: '', payee: '' });
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [sum, setSum] = useState<ExpenseSummary | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => void call<ExpenseCategory[]>('expense.categories').then(setCats), [tick]);
  useEffect(() => {
    const [fromDay, toDay] = range;
    call<ExpenseRow[]>('expense.list', { fromDay, toDay, categoryId: filter.categoryId || undefined, payState: filter.payState || undefined, payee: filter.payee || undefined })
      .then(setRows, (e: Error) => setMsg({ kind: 'error', text: t(e.message) }));
    call<ExpenseSummary>('expense.summary', { fromDay, toDay }).then(setSum, () => setSum(null));
  }, [range, filter, tick]);

  const catName = (id: number) => {
    const c = cats.find((x) => x.id === id);
    return c ? (lang === 'ar' ? c.nameAr : c.nameEn) : '';
  };
  const copyCsv = async () => {
    const head = ['No', 'Date', 'Due', 'Description', 'Category', 'Payee', 'Invoice', 'Gross', 'VAT', 'VAT class', 'Recoverable', 'Paid', 'Outstanding', 'Status'];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.expenseNo, r.expenseDate, r.dueDate, r.description, r.category, r.payee, r.invoiceRef, formatSar(r.gross), formatSar(r.vatAmount), r.vatClass, r.vatRecoverable ? 'yes' : 'no', formatSar(r.paid), formatSar(r.outstanding), r.payState].map(q).join(','));
    try {
      await navigator.clipboard.writeText([head.map(q).join(','), ...lines].join('\r\n'));
      setMsg({ kind: 'ok', text: t('Copied {0} rows. Paste into Excel.', rows.length) });
    } catch {
      setMsg({ kind: 'error', text: t('Could not copy to the clipboard') });
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('Expenses')} desc={t('Rent, bills, salaries and other store costs: owed, paid and overdue.')} actions={<>{can('expense.create') && <button className="primary" onClick={() => setEditing('new')}>{t('New expense')}</button>}<HelpLink article="expenses-record" /></>} />
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', maxWidth: 1100 }}>
        <div>
          <label>{t('Period')}</label>
          <select value={preset} onChange={(e) => {
            const v = e.target.value as typeof preset;
            setPreset(v);
            if (v === 'this') setRange(monthRange(0));
            if (v === 'prev') setRange(monthRange(-1));
          }}>
            <option value="this">{t('This month')}</option>
            <option value="prev">{t('Previous month')}</option>
            <option value="custom">{t('Custom')}</option>
          </select>
        </div>
        <div><label>{t('From')}</label><input type="date" value={range[0]} onChange={(e) => { setPreset('custom'); setRange([e.target.value, range[1]]); }} /></div>
        <div><label>{t('To')}</label><input type="date" value={range[1]} onChange={(e) => { setPreset('custom'); setRange([range[0], e.target.value]); }} /></div>
        <div>
          <label>{t('Category')}</label>
          <select value={filter.categoryId} onChange={(e) => setFilter({ ...filter, categoryId: Number(e.target.value) })}>
            <option value={0}>{t('All')}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{lang === 'ar' ? c.nameAr : c.nameEn}</option>)}
          </select>
        </div>
        <div>
          <label>{t('Status')}</label>
          <select value={filter.payState} onChange={(e) => setFilter({ ...filter, payState: e.target.value })}>
            <option value="">{t('All')}</option>
            {STATES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
        </div>
        <div><label>{t('Payee')}</label><input data-kb-search="filter" value={filter.payee} onChange={(e) => setFilter({ ...filter, payee: e.target.value })} /></div>
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}

      {sum && (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <Kpi l={t('Expenses in period (posted, incl. VAT)')} v={formatSar(sum.totalPosted)} />
            <Kpi l={t('Excl. recoverable VAT')} v={formatSar(sum.netOfRecoverableVat)} />
            <Kpi l={t('Recoverable input VAT')} v={formatSar(sum.recoverableVat)} />
            <Kpi l={t('Paid in period (cash basis)')} v={formatSar(sum.paidInPeriod)} />
            <Kpi l={t('Still owed today')} v={formatSar(sum.outstandingNow)} />
            <Kpi l={t('Overdue today')} v={formatSar(sum.overdueNow)} bad={sum.overdueNow > 0} />
            <Kpi l={t('Drafts waiting')} v={String(sum.draftsCount)} />
          </div>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ minWidth: 280 }}>
              <h4>{t('By category')}</h4>
              <table className="list"><tbody>{sum.byCategory.map((c) => <tr key={c.category}><td>{t(c.category)}</td><td className="num">{c.count}</td><td className="num">{formatSar(c.gross)}</td></tr>)}</tbody></table>
            </div>
            <div style={{ minWidth: 280 }}>
              <h4>{t('Monthly trend (posted)')}</h4>
              <Bars data={sum.byMonth.map((m) => ({ label: m.month, value: m.gross }))} />
            </div>
            <div style={{ minWidth: 320 }}>
              <h4>{t('Recurring: expected vs actual')}</h4>
              <table className="list">
                <thead><tr><th>{t('Name')}</th><th>{t('Period')}</th><th className="num">{t('Expected')}</th><th className="num">{t('Actual')}</th><th>{t('Status')}</th></tr></thead>
                <tbody>{sum.recurring.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.period?.split('@')[0] ?? '—'}</td><td className="num">{formatSar(r.expected)}</td><td className="num">{r.actual === null ? '—' : formatSar(r.actual)}</td><td>{t(r.status)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ alignItems: 'center', marginTop: 12 }}>
        <h4 style={{ margin: 0 }}>{t('Expenses ({0})', rows.length)}</h4>
        <button onClick={copyCsv} disabled={rows.length === 0}>{t('Copy as CSV')}</button>
      </div>
      <table className="list">
        <thead><tr><th>{t('No.')}</th><th>{t('Date')}</th><th>{t('Description')}</th><th>{t('Category')}</th><th>{t('Payee')}</th><th className="num">{t('Amount')}</th><th className="num">{t('Paid')}</th><th>{t('Status')}</th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={8} text={t('No expenses in this period. Use New expense to add one.')} />}
          {rows.map((r) => (
            <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}>
              <td>{r.expenseNo}</td><td>{r.expenseDate}</td><td>{r.description}</td><td>{catName(r.categoryId)}</td><td>{r.payee}</td>
              <td className="num">{formatSar(r.gross)}</td><td className="num">{formatSar(r.paid)}</td><td><StatusBadge status={r.payState} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && <ExpenseForm cats={cats.filter((c) => c.active)} can={can} initial={editing === 'new' ? null : editing} onClose={(m) => { setEditing(null); if (m) setMsg(m); reload(); }} />}
      {openId !== null && !editing && <ExpenseDetail id={openId} can={can} onEdit={(r) => setEditing(r)} onClose={() => { setOpenId(null); reload(); }} />}
      {can('expense.view') && <Recurring cats={cats} can={can} onChange={reload} />}
      {can('expense.approve') && <Categories cats={cats} onChange={reload} />}
    </div>
  );
}

function Kpi({ l, v, bad }: { l: string; v: string; bad?: boolean }) {
  return <div className="kpi"><div className="l">{l}</div><div className={`v${bad ? ' neg' : ''}`}>{v}</div></div>;
}

/** Simple labelled bars: every bar also shows its number, so nothing depends on reading the bar length. */
export function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  if (data.length === 0) return <p className="hint">—</p>;
  return (
    <table className="list">
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <td style={{ width: 80 }}>{d.label}</td>
            <td><div style={{ height: 12, width: `${Math.max(2, roundDiv(Math.abs(d.value) * 100, max))}%`, background: d.value < 0 ? 'var(--danger)' : 'var(--primary)', borderRadius: 3 }} /></td>
            <td className="num" style={{ width: 110 }}>{formatSar(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpenseForm({ cats, can, initial, onClose }: { cats: ExpenseCategory[]; can: (p: string) => boolean; initial: ExpenseRow | null; onClose: (m?: Msg) => void }) {
  const { t, lang } = useI18n();
  const [f, setF] = useState({
    categoryId: initial?.categoryId ?? 0, // no default: the first category could be a capital (asset) one
    description: initial?.description ?? '',
    payee: initial?.payee ?? '',
    invoiceRef: initial?.invoiceRef ?? '',
    supplierVatNo: initial?.supplierVatNo ?? '',
    notes: initial?.notes ?? '',
    attachmentRef: initial?.attachmentRef ?? '',
    expenseDate: initial?.expenseDate ?? todayDay(),
    dueDate: initial?.dueDate ?? '',
    prepaid: !!initial?.periodStart,
    periodStart: initial?.periodStart ?? '',
    periodEnd: initial?.periodEnd ?? '',
    gross: initial ? formatSar(initial.gross) : '',
    vatClass: (initial?.vatClass ?? 'standard') as VatClass,
    vatAmount: initial ? formatSar(initial.vatAmount) : '',
    vatRecoverable: initial?.vatRecoverable ?? false,
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const payKey = useRef(crypto.randomUUID());
  const gross = sarOrZero(f.gross);
  const vat = f.vatClass === 'standard' ? sarOrZero(f.vatAmount) : 0;

  const payload = () => ({
    categoryId: f.categoryId,
    description: f.description,
    payee: f.payee || undefined,
    invoiceRef: f.invoiceRef || undefined,
    supplierVatNo: f.supplierVatNo || undefined,
    notes: f.notes || undefined,
    attachmentRef: f.attachmentRef || undefined,
    expenseDate: f.expenseDate,
    dueDate: f.dueDate || undefined,
    periodStart: f.prepaid ? f.periodStart : undefined,
    periodEnd: f.prepaid ? f.periodEnd : undefined,
    gross,
    vatClass: f.vatClass,
    vatAmount: vat,
    vatRecoverable: f.vatClass === 'standard' && f.vatRecoverable,
  });

  const save = async (then: 'draft' | 'post' | 'bank' | 'till') => {
    if (busy) return;
    if (!f.categoryId) return setMsg({ kind: 'error', text: t('Choose a category') });
    if (!Number.isSafeInteger(gross) || gross <= 0 || Number.isNaN(vat)) return setMsg({ kind: 'error', text: t('Check the amounts') });
    setBusy(true);
    setMsg(null);
    try {
      let id = initial?.id;
      if (id) await call('expense.update', { id, ...payload() });
      else id = await call<number>('expense.create', { requestKey: requestKey.current, ...payload() });
      if (then !== 'draft') await call('expense.post', { id, payNow: then === 'post' ? undefined : { requestKey: payKey.current, method: then } });
      onClose({ kind: 'ok', text: then === 'draft' ? t('Draft saved') : then === 'post' ? t('Expense posted (owed until paid)') : t('Expense posted and paid') });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <div className="card section" role="dialog" aria-label="expense form" style={{ marginTop: 'var(--sp-4)' }}>
      <h3>{initial ? t('Edit draft {0}', initial.expenseNo) : t('New expense')}</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <label>{t('Category')}</label>
          <select aria-label="expense category" value={f.categoryId} onChange={(e) => set({ categoryId: Number(e.target.value) })}>
            <option value={0}>{t('— choose —')}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{lang === 'ar' ? c.nameAr : c.nameEn}{c.kind === 'capital' ? ` (${t('asset')})` : ''}</option>)}
          </select>
        </div>
        <div><label>{t('Description')}</label><input aria-label="expense description" value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div><label>{t('Payee / supplier')}</label><input value={f.payee} onChange={(e) => set({ payee: e.target.value })} /></div>
        <div><label>{t('Invoice / reference no.')}</label><input value={f.invoiceRef} onChange={(e) => set({ invoiceRef: e.target.value })} /></div>
        <div><label>{t('Supplier VAT no.')}</label><input value={f.supplierVatNo} onChange={(e) => set({ supplierVatNo: e.target.value })} /></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div><label>{t('Expense date (when the cost belongs)')}</label><input type="date" value={f.expenseDate} onChange={(e) => set({ expenseDate: e.target.value })} /></div>
        <div><label>{t('Due date')}</label><input type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div><label>{t('Total incl. VAT (SAR)')}</label><input aria-label="expense amount" value={f.gross} onChange={(e) => set({ gross: e.target.value })} /></div>
        <div>
          <label>{t('VAT treatment')}</label>
          <select value={f.vatClass} onChange={(e) => set({ vatClass: e.target.value as VatClass })}>
            {VAT.map((v) => <option key={v} value={v}>{t(VAT_LABEL[v])}</option>)}
          </select>
        </div>
        {f.vatClass === 'standard' && (
          <div>
            <label>{t('VAT amount from the invoice (SAR)')}</label>
            <div className="row">
              <input value={f.vatAmount} onChange={(e) => set({ vatAmount: e.target.value })} />
              <button type="button" title={t('Suggests 15/115 of the total. Check it against the invoice.')} disabled={!(gross > 0)}
                onClick={() => set({ vatAmount: formatSar(roundDiv(gross * 15, 115)) })}>15%</button>
            </div>
          </div>
        )}
      </div>
      {f.vatClass === 'standard' && (
        <label><input type="checkbox" checked={f.vatRecoverable} onChange={(e) => set({ vatRecoverable: e.target.checked })} /> {t('Input VAT is recoverable (tax invoice with supplier VAT number)')}</label>
      )}
      <label><input type="checkbox" checked={f.prepaid} onChange={(e) => set({ prepaid: e.target.checked })} /> {t('Covers several months (prepaid, e.g. yearly rent)')}</label>
      {f.prepaid && (
        <div className="row">
          <div><label>{t('First month')}</label><input type="month" value={f.periodStart} onChange={(e) => set({ periodStart: e.target.value })} /></div>
          <div><label>{t('Last month')}</label><input type="month" value={f.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} /></div>
        </div>
      )}
      <div className="row">
        <div><label>{t('Notes')}</label><input value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        <div><label>{t('Receipt reference (file name or folder no.)')}</label><input value={f.attachmentRef} onChange={(e) => set({ attachmentRef: e.target.value })} /></div>
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => save('draft')}>{t('Save draft')}</button>
        {can('expense.approve') && <button className="primary" disabled={busy} onClick={() => save('post')}>{t('Save and post (unpaid)')}</button>}
        {can('expense.approve') && can('expense.pay') && <button className="primary" disabled={busy} onClick={() => save('bank')}>{t('Post and pay by bank')}</button>}
        {can('expense.approve') && can('expense.pay') && <button disabled={busy} onClick={() => save('till')}>{t('Post and pay from till')}</button>}
        <button onClick={() => onClose()}>{t('Close')}</button>
      </div>
    </div>
  );
}

type Payment = { id: number; amount: number; method: PayMethod; paidOn: string; reference: string | null; reversedOf: number | null; reason: string | null; user: string; reversed: number | null };

function ExpenseDetail({ id, can, onEdit, onClose }: { id: number; can: (p: string) => boolean; onEdit: (r: ExpenseRow) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<{ expense: ExpenseRow; payments: Payment[] } | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'bank' as PayMethod, paidOn: todayDay(), reference: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const payKey = useRef(crypto.randomUUID());
  const load = () => call<{ expense: ExpenseRow; payments: Payment[] }>('expense.get', { id }).then((r) => {
    setD(r);
    setPay((p) => ({ ...p, amount: r.expense.outstanding ? formatSar(r.expense.outstanding) : '' }));
  });
  useEffect(() => void load(), [id]);

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
  // Electron has no window.prompt, so reasons are typed into an inline box.
  const [asking, setAsking] = useState<{ q: string; run: (reason: string) => void } | null>(null);
  const [reason, setReason] = useState('');
  const ask = (q: string, run: (reason: string) => void) => {
    setReason('');
    setAsking({ q, run });
  };
  if (!d) return null;
  const e = d.expense;
  return (
    <div className="card section" role="dialog" aria-label="expense detail" style={{ marginTop: 'var(--sp-4)' }}>
      <h3>{e.expenseNo} · <StatusBadge status={e.payState} /></h3>
      <table className="list"><tbody>
        <tr><td>{t('Description')}</td><td>{e.description}</td></tr>
        <tr><td>{t('Category')}</td><td>{t(e.category)}</td></tr>
        <tr><td>{t('Payee')}</td><td>{e.payee}</td></tr>
        <tr><td>{t('Invoice / reference no.')}</td><td>{e.invoiceRef} {e.supplierVatNo ? `· VAT ${e.supplierVatNo}` : ''}</td></tr>
        <tr><td>{t('Dates')}</td><td>{e.expenseDate}{e.dueDate ? ` · ${t('due')} ${e.dueDate}` : ''}{e.periodStart ? ` · ${e.periodStart} → ${e.periodEnd}` : ''}</td></tr>
        <tr><td>{t('Amount')}</td><td className="num">{formatSar(e.gross)} ({t(VAT_LABEL[e.vatClass])}, VAT {formatSar(e.vatAmount)}{e.vatRecoverable ? `, ${t('recoverable')}` : ''})</td></tr>
        <tr><td>{t('Paid / still owed')}</td><td className="num">{formatSar(e.paid)} / {formatSar(e.outstanding)}</td></tr>
        <tr><td>{t('Recorded by')}</td><td>{e.createdBy}{e.postedBy ? ` · ${t('posted by')} ${e.postedBy}` : ''}{e.closedBy ? ` · ${e.status} ${t('by')} ${e.closedBy}: ${e.closeReason}` : ''}</td></tr>
        {e.notes && <tr><td>{t('Notes')}</td><td>{e.notes}</td></tr>}
        {e.attachmentRef && <tr><td>{t('Receipt reference')}</td><td>{e.attachmentRef}</td></tr>}
        {!e.amountConfirmed && <tr><td colSpan={2} className="msg warn">{t('Amount not confirmed: enter the actual amount and VAT from the bill (Edit) before posting.')}</td></tr>}
      </tbody></table>

      {d.payments.length > 0 && (
        <>
          <h4>{t('Payments')}</h4>
          <table className="list"><tbody>
            {d.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.paidOn}</td><td>{p.method === 'till' ? t('Till cash') : t('Bank')}</td><td>{p.reference ?? p.reason}</td><td>{p.user}</td><td className="num">{formatSar(p.amount)}</td>
                <td>{p.amount > 0 && !p.reversed && can('expense.reverse') && (
                  <button className="danger" disabled={busy} onClick={() => ask(t('Why is this payment being reversed?'), (r) => void act(() => call('expense.reversePayment', { paymentId: p.id, requestKey: crypto.randomUUID(), reason: r }), t('Payment reversed')))}>{t('Reverse')}</button>
                )}{p.reversed ? t('reversed') : ''}</td>
              </tr>
            ))}
          </tbody></table>
        </>
      )}

      {e.status === 'posted' && e.outstanding > 0 && can('expense.pay') && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label>{t('Pay amount (SAR)')}</label><input aria-label="pay amount" value={pay.amount} onChange={(x) => setPay({ ...pay, amount: x.target.value })} /></div>
          <div><label>{t('From')}</label><select value={pay.method} onChange={(x) => setPay({ ...pay, method: x.target.value as PayMethod })}><option value="bank">{t('Bank')}</option><option value="till">{t('Till cash (open shift)')}</option></select></div>
          <div><label>{t('Payment date')}</label><input type="date" value={pay.paidOn} onChange={(x) => setPay({ ...pay, paidOn: x.target.value })} /></div>
          <div><label>{t('Reference')}</label><input value={pay.reference} onChange={(x) => setPay({ ...pay, reference: x.target.value })} /></div>
          <button className="primary" disabled={busy || Number.isNaN(sarOrZero(pay.amount)) || sarOrZero(pay.amount) <= 0}
            onClick={() => act(() => call('expense.pay', { id, requestKey: payKey.current, amount: sarOrZero(pay.amount), method: pay.method, paidOn: pay.paidOn, reference: pay.reference || undefined }), t('Payment recorded'))}>
            {t('Record payment')}
          </button>
        </div>
      )}
      {asking && (
        <div className="msg warn" role="group" aria-label="reason">
          <label>{asking.q}</label>
          <div className="row">
            <input aria-label="reason text" autoFocus value={reason} onChange={(x) => setReason(x.target.value)} />
            <button className="danger" disabled={!reason.trim() || busy} onClick={() => { asking.run(reason.trim()); setAsking(null); }}>{t('Confirm')}</button>
            <button onClick={() => setAsking(null)}>{t('Close')}</button>
          </div>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {e.status === 'draft' && can('expense.create') && <button onClick={() => onEdit(e)}>{t('Edit')}</button>}
        {e.status === 'draft' && can('expense.approve') && <button className="primary" disabled={busy} onClick={() => act(() => call('expense.post', { id }), t('Expense posted (owed until paid)'))}>{t('Post (approve)')}</button>}
        {e.status === 'draft' && can('expense.create') && <button className="danger" disabled={busy} onClick={() => ask(t('Why cancel this draft?'), (r) => void act(() => call('expense.cancel', { id, reason: r }), t('Draft cancelled')))}>{t('Cancel draft')}</button>}
        {e.status === 'posted' && can('expense.reverse') && <button className="danger" disabled={busy} onClick={() => ask(t('Why is this expense being reversed?'), (r) => void act(() => call('expense.reverse', { id, reason: r }), t('Expense reversed')))}>{t('Reverse expense')}</button>}
        <button onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  );
}

type RecurringRow = { id: number; name: string; categoryId: number; category: string; expectedGross: number; variableAmount: number; interval: 'monthly' | 'quarterly' | 'yearly'; startDate: string; endDate: string | null; dueDay: number; payee: string | null; vatClass: VatClass; vatRecoverable: number; active: number };

function Recurring({ cats, can, onChange }: { cats: ExpenseCategory[]; can: (p: string) => boolean; onChange: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RecurringRow[]>([]);
  const empty = { id: 0, name: '', categoryId: 0, expected: '', variableAmount: false, interval: 'monthly' as RecurringRow['interval'], startDate: todayDay(), endDate: '', dueDay: '1', payee: '', vatClass: 'out_of_scope' as VatClass, vatRecoverable: false, active: true };
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<RecurringRow[]>('expense.recurring').then(setRows);
  useEffect(() => void load(), []);
  const save = async () => {
    setMsg(null);
    try {
      await call('expense.saveRecurring', {
        id: f.id || undefined, name: f.name, categoryId: f.categoryId, expectedGross: sarOrZero(f.expected), variableAmount: f.variableAmount, interval: f.interval,
        startDate: f.startDate, endDate: f.endDate || undefined, dueDay: Number(f.dueDay), payee: f.payee || undefined, vatClass: f.vatClass, vatRecoverable: f.vatClass === 'standard' && f.vatRecoverable, active: f.active,
      });
      setF(empty);
      setMsg({ kind: 'ok', text: t('Saved. Drafts are created when each period starts; nothing is paid automatically.') });
      void load();
      onChange();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h4>{t('Recurring expenses')}</h4>
      <table className="list">
        <thead><tr><th>{t('Name')}</th><th>{t('Category')}</th><th>{t('Every')}</th><th className="num">{t('Expected')}</th><th>{t('Due day')}</th><th>{t('Status')}</th><th /></tr></thead>
        <tbody>{rows.length === 0 && <EmptyRow cols={7} text={t('No recurring expenses yet.')} />}{rows.map((r) => (
          <tr key={r.id}>
            <td>{r.name}{r.variableAmount ? ` (${t('variable')})` : ''}</td><td>{t(r.category)}</td><td>{t(r.interval)}</td><td className="num">{formatSar(r.expectedGross)}</td><td>{r.dueDay}</td><td>{r.active ? t('Active') : t('Off')}</td>
            <td>{can('expense.approve') && <button onClick={() => setF({ id: r.id, name: r.name, categoryId: r.categoryId, expected: formatSar(r.expectedGross), variableAmount: !!r.variableAmount, interval: r.interval, startDate: r.startDate, endDate: r.endDate ?? '', dueDay: String(r.dueDay), payee: r.payee ?? '', vatClass: r.vatClass, vatRecoverable: !!r.vatRecoverable, active: !!r.active })}>{t('Edit')}</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      {can('expense.approve') && (
        <div className="card section">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div><label>{t('Name')}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label>{t('Category')}</label><select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })}><option value={0}>{t('— choose —')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{t(c.nameEn)}</option>)}</select></div>
            <div><label>{t('Expected amount (SAR)')}</label><input value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div><label>{t('Every')}</label><select value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as RecurringRow['interval'] })}><option value="monthly">{t('monthly')}</option><option value="quarterly">{t('quarterly')}</option><option value="yearly">{t('yearly')}</option></select></div>
            <div><label>{t('Start')}</label><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
            <div><label>{t('End (optional)')}</label><input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
            <div><label>{t('Due day')}</label><input value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} /></div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div><label>{t('Payee')}</label><input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></div>
            <div><label>{t('VAT treatment')}</label><select value={f.vatClass} onChange={(e) => setF({ ...f, vatClass: e.target.value as VatClass })}>{VAT.map((v) => <option key={v} value={v}>{t(VAT_LABEL[v])}</option>)}</select></div>
          </div>
          <label><input type="checkbox" checked={f.variableAmount} onChange={(e) => setF({ ...f, variableAmount: e.target.checked })} /> {t('Amount changes each time (e.g. electricity)')}</label>
          <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('Active')}</label>
          {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          <p><button className="primary" disabled={!f.name.trim() || !f.categoryId || !(sarOrZero(f.expected) > 0)} onClick={save}>{f.id ? t('Update') : t('Add recurring expense')}</button></p>
        </div>
      )}
    </div>
  );
}

function Categories({ cats, onChange }: { cats: ExpenseCategory[]; onChange: () => void }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<{ code: string; nameEn: string }[]>([]);
  const [f, setF] = useState({ id: 0, nameEn: '', nameAr: '', accountCode: '6900', active: true });
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => void call<{ code: string; nameEn: string }[]>('expense.accounts').then(setAccounts), []);
  const save = async () => {
    setMsg(null);
    try {
      await call('expense.saveCategory', { id: f.id || undefined, nameEn: f.nameEn, nameAr: f.nameAr, accountCode: f.accountCode, active: f.active });
      setF({ id: 0, nameEn: '', nameAr: '', accountCode: '6900', active: true });
      onChange();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h4>{t('Expense categories')}</h4>
      <p className="msg warn">{t('Account mapping is provisional until your accountant approves it.')}</p>
      <table className="list"><tbody>{cats.map((c) => (
        <tr key={c.id}><td>{c.nameEn}</td><td className="ar">{c.nameAr}</td><td>{c.accountCode}</td><td>{c.active ? t('Active') : t('Off')}</td>
          <td><button onClick={() => setF({ id: c.id, nameEn: c.nameEn, nameAr: c.nameAr, accountCode: c.accountCode, active: c.active })}>{t('Edit')}</button></td></tr>
      ))}</tbody></table>
      <div className="row" style={{ maxWidth: 720, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label>{t('Name (English)')}</label><input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
        <div><label>{t('Name (Arabic)')}</label><input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></div>
        <div><label>{t('Account')}</label><select value={f.accountCode} onChange={(e) => setF({ ...f, accountCode: e.target.value })}>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.nameEn}</option>)}</select></div>
        <label style={{ flex: '0 0 auto' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('Active')}</label>
        <button disabled={!f.nameEn.trim()} onClick={save}>{f.id ? t('Update') : t('Add category')}</button>
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
