import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatQty, formatSar, parseSar } from '../core/money';
import { ScanBuffer } from '../core/scan-buffer';
import { computeInvoice } from '../core/vat';
import type { LookupResult, Product } from '../services/catalog';
import type { HeldBill } from '../services/held-bills';
import type { SearchHit } from '../services/search';
import type { Customer } from '../services/parties';
import type { SaleResult } from '../services/sales';
import type { ShiftSummary } from '../services/shifts';
import { call, type ApiError } from './api';
import { SearchBox } from './SearchBox';
import { decideKey, incrementQtyText, parseStepQty, type CheckoutStep, type KeyContext } from './checkout-keys';
import { ProductName, useI18n } from './i18n';

interface Line {
  product: Product;
  qty: number;
  discount: number; // halalas
}

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

/**
 * Removes scanned characters from whatever box had focus (customer phone, search, cash…). The value is set through
 * the native setter and an input event is fired, so React's state is updated too; setting el.value alone is undone
 * by React on the next render (BUG-011).
 */
function removeScannedText(el: HTMLInputElement, code: string) {
  if (!el.value.endsWith(code)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, el.value.slice(0, -code.length));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function Sell({ canDiscount }: { canDiscount: boolean }) {
  const { t } = useI18n();
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(undefined);
  const [float, setFloat] = useState('0');
  const [lines, setLines] = useState<Line[]>([]);
  const [cash, setCash] = useState('');
  const [cardPart, setCardPart] = useState('');
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
  const busyRef = useRef(false); // scans while a payment is being saved must not be lost (BUG-002)
  // Keyboard checkout (ADR-2): exactly one step is active and its input has focus.
  const [step, setStep] = useState<CheckoutStep>('search');
  const stepAt = useRef(0);
  const [pending, setPending] = useState<{ product: Product; text: string; error?: string } | null>(null);
  const lastUnitProduct = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  // Focus moves only when a keyboard step asks for it (moveFocus = true). When the cashier clicks into a field,
  // the step follows the click but focus stays exactly where they clicked.
  const focusWanted = useRef(true);
  const [focusTick, setFocusTick] = useState(0);
  const goStep = useCallback((s: CheckoutStep, moveFocus = true) => {
    if (moveFocus) {
      focusWanted.current = true;
      setFocusTick((n) => n + 1);
    }
    setStep((prev) => {
      if (prev !== s) stepAt.current = performance.now();
      return s;
    });
  }, []);
  // The search box is disabled while a payment is saving, so a pending focus request waits until saving ends.
  useEffect(() => {
    if (busy || !focusWanted.current) return;
    focusWanted.current = false;
    if (step === 'search') searchRef.current?.focus();
    else if (step === 'qty') {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    } else cashRef.current?.focus();
  }, [step, busy, focusTick]);

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

  const addLine = useCallback((product: Product, qty: number) => {
    if (product.sellMode === 'unit') lastUnitProduct.current = product.id;
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id && product.sellMode === 'unit');
      if (i < 0) return [...prev, { product, qty, discount: 0 }];
      return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + qty } : l));
    });
  }, []);

  const pickProduct = (p: Product) => {
    if (busyRef.current) return setMsg({ kind: 'warn', text: t('Wait until the payment is saved, then add the item.') });
    if (p.sellMode === 'weight') return setMsg({ kind: 'warn', text: t('{0} is sold by weight. Scan the scale label.', p.nameEn) });
    setMsg(null);
    setPending({ product: p, text: '1' }); // picked from the list: confirm the quantity first
    goStep('qty');
  };

  /** A code typed by hand and confirmed with Enter. Scanner bursts never come here (they add straight away). */
  const typedCode = async (code: string) => {
    if (busyRef.current) return setMsg({ kind: 'warn', text: t('Wait until the payment is saved, then add the item.') });
    setMsg(null);
    try {
      const r = await call<LookupResult | null>('catalog.lookup', { code });
      if (!r) return setMsg({ kind: 'error', text: t('Not found: {0}', code) });
      if (r.qty === 0) return setMsg({ kind: 'warn', text: t('{0} is sold by weight. Scan the scale label.', r.product.nameEn) });
      if (r.source === 'scale') return addLine(r.product, r.qty); // the label carries the weight
      setPending({ product: r.product, text: formatQty(r.qty, 0) });
      goStep('qty');
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  const incLast = () => {
    const id = lastUnitProduct.current;
    if (id === null || !lines.some((l) => l.product.id === id && l.product.sellMode === 'unit')) {
      return setMsg({ kind: 'warn', text: t('Nothing to add one to: the last item is sold by weight or was removed.') });
    }
    setMsg(null);
    setLines((prev) => prev.map((l) => (l.product.id === id && l.product.sellMode === 'unit' ? { ...l, qty: l.qty + 1000 } : l)));
  };

  const addCode = useCallback(async (code: string, possibleDuplicate = false) => {
    if (busyRef.current) return setMsg({ kind: 'warn', text: t('Wait until the payment is saved, then add the item.') });
    setMsg(null);
    try {
      const r = await call<LookupResult | null>('catalog.lookup', { code });
      if (!r) return setMsg({ kind: 'error', text: t('Not found: {0}', code) });
      if (r.qty === 0) {
        // Manual weight entry is not approved yet (plan §Q-8); weighed goods need a scale label.
        return setMsg({ kind: 'warn', text: t('{0} is sold by weight. Scan the scale label.', r.product.nameEn) });
      }
      if (possibleDuplicate && !window.confirm(t('{0} was scanned twice very quickly. Add it again?', r.product.nameEn))) return;
      addLine(r.product, r.qty);
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  }, [addLine]);

  // Scanner input is caught globally, whatever has focus (plan §I).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const scan = scanner.current.key(e.key, e.timeStamp);
      if (!scan) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof HTMLInputElement) removeScannedText(e.target, scan.code);
      void addCode(scan.code, scan.possibleDuplicate);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addCode]);

  const resetBill = () => {
    billKey.current = crypto.randomUUID();
    setLines([]);
    setCash('');
    setCardPart('');
    setCustomer(null);
    setApprover({ username: '', pin: '' });
  };

  const pay = async (tender: 'cash' | 'card') => {
    if (!totals || busyRef.current) return;
    let payments: { tender: 'cash' | 'card'; amount: number }[];
    try {
      const card = cardPart.trim() ? parseSar(cardPart) : 0;
      if (tender === 'card') payments = [{ tender: 'card', amount: totals.totalIncl }];
      else {
        // Cash, optionally with part of the bill on card ("split").
        const cashAmount = cash.trim() ? parseSar(cash) : totals.totalIncl - card;
        payments = [...(card > 0 ? [{ tender: 'card' as const, amount: card }] : []), ...(cashAmount > 0 ? [{ tender: 'cash' as const, amount: cashAmount }] : [])];
      }
    } catch {
      return setMsg({ kind: 'error', text: t('Cash amount is not a valid number') });
    }
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<SaleResult>('sale.finalize', {
        idempotencyKey: billKey.current,
        // The prices the cashier sees are sent too: if a price changed meanwhile, the sale is refused, not charged differently.
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, discount: l.discount || undefined, expectedUnitPrice: l.product.priceIncl })),
        payments,
        approver: needsApproval ? approver : undefined,
        customerId: customer?.id,
      });
      resetBill();
      goStep('search');
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
      if ((e as ApiError).code === 'PRICE_CHANGED') await refreshPrices();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** After a price change, reload current prices so the screen shows exactly what will be charged. */
  const refreshPrices = async () => {
    const fresh = new Map<number, Product>();
    for (const l of lines) {
      if (fresh.has(l.product.id)) continue;
      const hits = await call<SearchHit[]>('catalog.suggest', { text: l.product.sku }).catch(() => [] as SearchHit[]);
      const p = hits.find((h) => h.product.id === l.product.id)?.product;
      if (p) fresh.set(p.id, p);
    }
    setLines((prev) => prev.map((l) => ({ ...l, product: fresh.get(l.product.id) ?? l.product })));
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

  /** Runs a key through the state machine for the focused field. Returns true when the key was used. */
  const onStepKey = (field: KeyContext['field'], e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    const a = decideKey(
      { key: e.key, ctrl: e.ctrlKey || e.metaKey, repeat: e.repeat, msSinceStepChange: performance.now() - stepAt.current },
      { step, field, searchEmpty: true, billHasItems: lines.length > 0 && !!totals, splitCardTyped: cardPart.trim() !== '', busy: busyRef.current },
    );
    if (a.type === 'none') return false;
    e.preventDefault();
    switch (a.type) {
      case 'openPay': goStep('pay'); break;
      case 'incLast': incLast(); break;
      case 'qtyInc': setPending((p) => (p ? { ...p, text: incrementQtyText(p.text), error: undefined } : p)); break;
      case 'qtyConfirm': {
        if (!pending) break;
        const r = parseStepQty(pending.text, pending.product.sellMode);
        if ('error' in r) setPending({ ...pending, error: r.error });
        else {
          addLine(pending.product, r.qty);
          setPending(null);
          goStep('search');
        }
        break;
      }
      case 'toSearch': setPending(null); goStep('search'); break;
      case 'focusCash': cashRef.current?.focus(); break;
      case 'payCash': void pay('cash'); break;
      case 'payCard': void pay('card'); break;
      case 'refuse': setMsg({ kind: 'warn', text: t('A split payment is in progress: press Enter in Cash received to finish it.') }); break;
    }
    return true;
  };

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
        <div className={`step${step === 'search' ? ' current' : ''}`}>
          <div className="step-label">{t('Scan or search')}</div>
          <SearchBox
            inputRef={searchRef}
            onPick={pickProduct}
            onCode={(c) => void typedCode(c)}
            disabled={busy}
            onEmptyKey={(e) => onStepKey('search', e)}
            onFocusBox={() => goStep('search', false)}
          />
          <small className="ar" style={{ direction: 'inherit' }}>{t('Empty box: Enter = payment · + = one more of the last item')}</small>
        </div>
        {step === 'qty' && pending && (
          <div className="step current" role="group" aria-label="quantity step">
            <div className="step-label">{t('Quantity')}</div>
            <div><ProductName en={pending.product.nameEn} ar={pending.product.nameAr} /> · {formatSar(pending.product.priceIncl)}</div>
            <input
              ref={qtyRef}
              aria-label="quantity"
              inputMode="numeric"
              value={pending.text}
              onChange={(e) => setPending({ ...pending, text: e.target.value, error: undefined })}
              onKeyDown={(e) => onStepKey('qty', e)}
              onBlur={() => setTimeout(() => {
                // Clicking elsewhere cancels the quantity step instead of leaving it half done.
                if (document.activeElement !== qtyRef.current) setPending((p) => (p ? null : p));
              }, 200)}
            />
            {pending.error && <div className="msg error">{t(pending.error)}</div>}
            <small className="ar" style={{ direction: 'inherit' }}>{t('Enter = add · + = one more · Esc = cancel')}</small>
          </div>
        )}
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
        <div className={`step${step === 'pay' ? ' current' : ''}`} role="group" aria-label="payment step">
          <div className="step-label">{t('Payment')}</div>
          <label>{t('Cash received (blank = exact)')}</label>
          <input
            ref={cashRef}
            aria-label="cash received"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            onFocus={() => lines.length > 0 && goStep('pay', false)}
            onKeyDown={(e) => onStepKey('cash', e)}
          />
          <label>{t('Card part of a split payment (optional)')}</label>
          <input
            aria-label="card part"
            value={cardPart}
            onChange={(e) => setCardPart(e.target.value)}
            onFocus={() => lines.length > 0 && goStep('pay', false)}
            onKeyDown={(e) => onStepKey('cardPart', e)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy || !totals || lines.length === 0} onClick={() => pay('cash')}>{t('Cash')} <span className="kbd">Enter</span></button>
            <button className="primary" disabled={busy || !totals || lines.length === 0} onClick={() => pay('card')}>{t('Card')} <span className="kbd">Ctrl+Enter</span></button>
          </div>
          {step === 'pay' && <small className="ar" style={{ direction: 'inherit' }}>{t('Card: record only after the bank terminal shows APPROVED.')} {t('Esc = back to the bill')}</small>}
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
