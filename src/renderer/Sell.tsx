import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatQty, formatSar, parseSar } from '../core/money';
import { ScanBuffer } from '../core/scan-buffer';
import { computeInvoice } from '../core/vat';
import type { LookupResult, Product } from '../services/catalog';
import type { HeldBill } from '../services/held-bills';
import type { Customer } from '../services/parties';
import type { SaleResult } from '../services/sales';
import type { ShiftSummary } from '../services/shifts';
import { call } from './api';
import { ProductName, useI18n } from './i18n';

interface Line {
  product: Product;
  qty: number;
  discount: number; // halalas
}

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

export function Sell({ canDiscount }: { canDiscount: boolean }) {
  const { t } = useI18n();
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(undefined);
  const [float, setFloat] = useState('0');
  const [lines, setLines] = useState<Line[]>([]);
  const [manual, setManual] = useState('');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [lastSaleId, setLastSaleId] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldBill[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custSearch, setCustSearch] = useState('');
  const [approver, setApprover] = useState({ username: '', pin: '' });
  // One key per bill: a retry after an error re-sends the same key, so it can never create a second sale.
  const billKey = useRef<string>(crypto.randomUUID());
  const scanner = useRef(new ScanBuffer());

  const loadHeld = () => call<HeldBill[]>('hold.list').then(setHeld);
  useEffect(() => {
    void call<ShiftSummary | null>('shift.current').then(setShift);
    void loadHeld();
  }, []);

  const totals = useMemo(() => {
    try {
      return computeInvoice(lines.map((l) => ({ unitPriceIncl: l.product.priceIncl, qty: l.qty, discount: l.discount, vatRate: l.product.vatRateBp })));
    } catch {
      return null; // e.g. a discount bigger than the line; shown as an error below
    }
  }, [lines]);
  const hasDiscount = lines.some((l) => l.discount > 0);
  const needsApproval = hasDiscount && !canDiscount;

  const addCode = useCallback(async (code: string, possibleDuplicate = false) => {
    setMsg(null);
    try {
      const r = await call<LookupResult | null>('catalog.lookup', { code });
      if (!r) return setMsg({ kind: 'error', text: t('Not found: {0}', code) });
      if (r.qty === 0) {
        // Manual weight entry is not approved yet (plan §Q-8); weighed goods need a scale label.
        return setMsg({ kind: 'warn', text: t('{0} is sold by weight. Scan the scale label.', r.product.nameEn) });
      }
      if (possibleDuplicate && !window.confirm(t('{0} was scanned twice very quickly. Add it again?', r.product.nameEn))) return;
      setLines((prev) => {
        const i = prev.findIndex((l) => l.product.id === r.product.id && r.product.sellMode === 'unit');
        if (i < 0) return [...prev, { product: r.product, qty: r.qty, discount: 0 }];
        return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + r.qty } : l));
      });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  }, []);

  // Scanner input is caught globally, whatever has focus (plan §I).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const scan = scanner.current.key(e.key, e.timeStamp);
      if (!scan) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof HTMLInputElement) {
        // Remove the scanned characters from whatever box had focus.
        const el = e.target;
        if (el.value.endsWith(scan.code)) el.value = el.value.slice(0, -scan.code.length);
      }
      setManual((m) => (m.endsWith(scan.code) ? m.slice(0, -scan.code.length) : m));
      void addCode(scan.code, scan.possibleDuplicate);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addCode]);

  const resetBill = () => {
    billKey.current = crypto.randomUUID();
    setLines([]);
    setCash('');
    setCustomer(null);
    setApprover({ username: '', pin: '' });
  };

  const pay = async (tender: 'cash' | 'card') => {
    if (!totals) return;
    let amount = totals.totalIncl;
    if (tender === 'cash' && cash.trim()) {
      try {
        amount = parseSar(cash);
      } catch {
        return setMsg({ kind: 'error', text: t('Cash amount is not a valid number') });
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<SaleResult>('sale.finalize', {
        idempotencyKey: billKey.current,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, discount: l.discount || undefined })),
        payments: [{ tender, amount }],
        approver: needsApproval ? approver : undefined,
        customerId: customer?.id,
      });
      resetBill();
      setLastSaleId(r.saleId);
      const warn = r.negativeStockProducts.length ? t(' Stock went below zero for some items.') : '';
      setMsg({ kind: 'ok', text: t('SAVED {0}. Change: {1} SAR.', r.invoiceNo, formatSar(r.changeGiven)) + warn });
      try {
        await call('sale.print', { saleId: r.saleId, copy: false });
      } catch (e) {
        setMsg({ kind: 'warn', text: t('SAVED {0}. Change: {1}. Printing failed: {2}. Use Reprint.', r.invoiceNo, formatSar(r.changeGiven), (e as Error).message) });
      }
    } catch (e) {
      // The bill stays on screen with the same key, so pressing pay again is safe.
      setMsg({ kind: 'error', text: t('NOT SAVED: {0}', t((e as Error).message)) });
    } finally {
      setBusy(false);
    }
  };

  /** Every removal before payment is audited (voids report). The line goes even if logging fails, but staff are told. */
  const removeLines = (kind: 'line_removed' | 'bill_cleared', idx: number[]) => {
    const gone = idx.map((i) => ({ productId: lines[i]!.product.id, qty: lines[i]!.qty, amount: totals ? totals.lines[i]!.lineIncl : 0 }));
    const billRef = billKey.current;
    setLines(lines.filter((_, k) => !idx.includes(k)));
    if (kind === 'bill_cleared') billKey.current = crypto.randomUUID(); // the cleared bill is finished; the next one is new
    call('bill.removed', { kind, lines: gone, billKey: billRef }).catch((e: Error) => setMsg({ kind: 'warn', text: t('Removed, but the removal could not be logged: {0}', e.message) }));
  };

  const hold = async () => {
    const label = customer?.name ?? `Bill ${new Date().toLocaleTimeString()}`;
    try {
      await call('hold.create', { label, lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })), customerId: customer?.id, billKey: billKey.current });
      resetBill();
      setMsg({ kind: 'ok', text: t('Held: {0}. Discounts are not kept on held bills.', label) });
      void loadHeld();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  const recall = async (id: number) => {
    if (lines.length) return setMsg({ kind: 'warn', text: t('Finish or hold the current bill first.') });
    try {
      const r = await call<{ billKey?: string; lines: { product: Product; qty: number }[] }>('hold.recall', { id });
      if (r.billKey) billKey.current = r.billKey; // removals made before holding stay linked to this bill
      setLines(r.lines.map((l) => ({ ...l, discount: 0 })));
      void loadHeld();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  const findCustomer = async () => {
    try {
      const found = await call<Customer[]>('customer.find', { text: custSearch });
      if (found.length === 1) setCustomer(found[0]!);
      else if (found.length === 0) {
        const name = custSearch.trim();
        if (window.confirm(`No customer found. Create "${name}" as a new customer with this as phone?`)) {
          const id = await call<number>('customer.create', { name, phone: /^\+?\d+$/.test(name) ? name : undefined });
          setCustomer({ id, name, phone: name, vatNumber: null });
        }
      } else setMsg({ kind: 'warn', text: `${found.length} customers match. Type more of the phone number.` });
      setCustSearch('');
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  if (shift === undefined) return null;
  if (shift === null) {
    return (
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setShift(await call<ShiftSummary>('shift.open', { openingFloat: parseSar(float) }));
          } catch (err) {
            setMsg({ kind: 'error', text: t((err as Error).message) });
          }
        }}
      >
        <h2>{t('Open shift')}</h2>
        <label>{t('Opening cash float (SAR)')}</label>
        <input value={float} onChange={(e) => setFloat(e.target.value)} />
        {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
        <p><button className="primary">{t('Open shift')}</button></p>
      </form>
    );
  }

  const setDiscount = (i: number, text: string) => {
    let d = 0;
    try {
      d = text.trim() ? parseSar(text) : 0;
    } catch {
      return;
    }
    setLines(lines.map((l, k) => (k === i ? { ...l, discount: d } : l)));
  };

  return (
    <div className="pos">
      <div className="cart">
        <table>
          <thead>
            <tr><th>{t('Item')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Price')}</th><th className="num">{t('Discount')}</th><th className="num">{t('Amount')}</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><ProductName en={l.product.nameEn} ar={l.product.nameAr} /></td>
                <td className="num">{formatQty(l.qty, l.product.sellMode === 'unit' ? 0 : 3)}</td>
                <td className="num">{formatSar(l.product.priceIncl)}</td>
                <td className="num" style={{ width: 90 }}>
                  <input aria-label="discount" defaultValue={l.discount ? formatSar(l.discount) : ''} onBlur={(e) => setDiscount(i, e.target.value)} />
                </td>
                <td className="num">{totals ? formatSar(totals.lines[i]!.lineIncl) : '—'}</td>
                <td><button className="danger" aria-label="remove line" onClick={() => removeLines('line_removed', [i])}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {held.length > 0 && (
          <div className="page">
            <strong>{t('Held bills:')}</strong>{' '}
            {held.map((h) => (
              <button key={h.id} onClick={() => recall(h.id)} style={{ marginRight: 6 }}>
                {h.label} ({h.lineCount})
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="side">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) void addCode(manual.trim());
            setManual('');
          }}
        >
          <label>{t('Scan, or type barcode / PLU / SKU and press Enter')}</label>
          <input autoFocus value={manual} onChange={(e) => setManual(e.target.value)} />
        </form>
        <div className="row">
          {customer ? (
            <span>{t('Customer:')} <strong>{customer.name}</strong> <button onClick={() => setCustomer(null)}>✕</button></span>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (custSearch.trim()) void findCustomer(); }} className="row">
              <input placeholder={t('Customer phone (optional)')} value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
            </form>
          )}
        </div>
        <div>
          {totals ? (
            <>
              <div className="row"><span>{t('Excl. VAT')}</span><span className="num">{formatSar(totals.totalExcl)}</span></div>
              <div className="row"><span>{t('VAT')}</span><span className="num">{formatSar(totals.totalVat)}</span></div>
              {hasDiscount && <div className="row"><span>{t('Discount')}</span><span className="num">-{formatSar(totals.totalDiscount)}</span></div>}
              <div className="total">{formatSar(totals.totalIncl)} {t('SAR')}</div>
            </>
          ) : (
            <div className="msg error">{t('A discount is larger than its line amount.')}</div>
          )}
        </div>
        {needsApproval && (
          <div className="msg warn">
            {t('Discount needs a supervisor:')}
            <div className="row">
              <input placeholder={t('Supervisor username')} value={approver.username} onChange={(e) => setApprover({ ...approver, username: e.target.value })} />
              <input placeholder={t('PIN')} type="password" value={approver.pin} onChange={(e) => setApprover({ ...approver, pin: e.target.value })} />
            </div>
          </div>
        )}
        <label>{t('Cash received (blank = exact)')}</label>
        <input aria-label="cash received" value={cash} onChange={(e) => setCash(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={busy || !totals || lines.length === 0} onClick={() => pay('cash')}>{t('Cash')}</button>
          <button className="primary" disabled={busy || !totals || lines.length === 0} onClick={() => pay('card')}>{t('Card')}</button>
        </div>
        <div className="row">
          <button disabled={busy || lines.length === 0} onClick={hold}>{t('Hold bill')}</button>
          <button className="danger" disabled={busy || lines.length === 0} onClick={() => window.confirm(t('Clear the whole bill?')) && removeLines('bill_cleared', lines.map((_, i) => i))}>{t('Clear bill')}</button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {lastSaleId !== null && (
          <button onClick={() => call('sale.print', { saleId: lastSaleId, copy: true }).catch((e: Error) => setMsg({ kind: 'error', text: t(e.message) }))}>
            {t('Reprint last receipt (copy)')}
          </button>
        )}
      </div>
    </div>
  );
}
