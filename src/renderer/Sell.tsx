import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatQty, formatSar, parseSar } from '../core/money';
import { ScanBuffer } from '../core/scan-buffer';
import { computeInvoice } from '../core/vat';
import type { LookupResult, Product } from '../services/catalog';
import type { SaleResult } from '../services/sales';
import type { ShiftSummary } from '../services/shifts';
import { call } from './api';

interface Line {
  product: Product;
  qty: number;
}

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

export function Sell() {
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(undefined);
  const [float, setFloat] = useState('0');
  const [lines, setLines] = useState<Line[]>([]);
  const [manual, setManual] = useState('');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [lastSaleId, setLastSaleId] = useState<number | null>(null);
  // One key per bill: a retry after an error re-sends the same key, so it can never create a second sale.
  const billKey = useRef(crypto.randomUUID());
  const scanner = useRef(new ScanBuffer());

  useEffect(() => void call<ShiftSummary | null>('shift.current').then(setShift), []);

  const totals = useMemo(
    () => computeInvoice(lines.map((l) => ({ unitPriceIncl: l.product.priceIncl, qty: l.qty, discount: 0, vatRate: l.product.vatRateBp }))),
    [lines],
  );

  const addCode = useCallback(async (code: string, possibleDuplicate = false) => {
    setMsg(null);
    try {
      const r = await call<LookupResult | null>('catalog.lookup', { code });
      if (!r) return setMsg({ kind: 'error', text: `Not found: ${code}` });
      if (r.qty === 0) {
        // Manual weight entry is not approved yet (plan §Q-8); weighed goods need a scale label.
        return setMsg({ kind: 'warn', text: `${r.product.nameEn} is sold by weight. Scan the scale label.` });
      }
      if (possibleDuplicate && !window.confirm(`${r.product.nameEn} was scanned twice very quickly. Add it again?`)) return;
      setLines((prev) => {
        const i = prev.findIndex((l) => l.product.id === r.product.id && r.product.sellMode === 'unit');
        if (i < 0) return [...prev, { product: r.product, qty: r.qty }];
        return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + r.qty } : l));
      });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, []);

  // Scanner input is caught globally, whatever has focus (plan §I).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const scan = scanner.current.key(e.key, e.timeStamp);
      if (!scan) return;
      e.preventDefault();
      e.stopPropagation();
      setManual((m) => (m.endsWith(scan.code) ? m.slice(0, -scan.code.length) : m));
      void addCode(scan.code, scan.possibleDuplicate);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addCode]);

  const pay = async (tender: 'cash' | 'card') => {
    let amount = totals.totalIncl;
    if (tender === 'cash' && cash.trim()) {
      try {
        amount = parseSar(cash);
      } catch {
        return setMsg({ kind: 'error', text: 'Cash amount is not a valid number' });
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<SaleResult>('sale.finalize', {
        idempotencyKey: billKey.current,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        payments: [{ tender, amount }],
      });
      billKey.current = crypto.randomUUID();
      setLines([]);
      setCash('');
      setLastSaleId(r.saleId);
      const warn = r.negativeStockProducts.length ? ' Stock went below zero for some items.' : '';
      setMsg({ kind: 'ok', text: `SAVED ${r.invoiceNo}. Change: ${formatSar(r.changeGiven)} SAR.${warn}` });
      try {
        await call('sale.print', { saleId: r.saleId, copy: false });
      } catch (e) {
        setMsg({ kind: 'warn', text: `SAVED ${r.invoiceNo}. Change: ${formatSar(r.changeGiven)}. Printing failed: ${(e as Error).message}. Use Reprint.` });
      }
    } catch (e) {
      // The bill stays on screen with the same key, so pressing pay again is safe.
      setMsg({ kind: 'error', text: `NOT SAVED: ${(e as Error).message}` });
    } finally {
      setBusy(false);
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
            setMsg({ kind: 'error', text: (err as Error).message });
          }
        }}
      >
        <h2>Open shift</h2>
        <label>Opening cash float (SAR)</label>
        <input value={float} onChange={(e) => setFloat(e.target.value)} />
        {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
        <p><button className="primary">Open shift</button></p>
      </form>
    );
  }

  return (
    <div className="pos">
      <div className="cart">
        <table>
          <thead>
            <tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.product.nameEn}<div className="ar">{l.product.nameAr}</div></td>
                <td className="num">{formatQty(l.qty, l.product.sellMode === 'unit' ? 0 : 3)}</td>
                <td className="num">{formatSar(l.product.priceIncl)}</td>
                <td className="num">{formatSar(totals.lines[i]!.lineIncl)}</td>
                <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="side">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) void addCode(manual.trim());
            setManual('');
          }}
        >
          <label>Scan, or type barcode / PLU / SKU and press Enter</label>
          <input autoFocus value={manual} onChange={(e) => setManual(e.target.value)} />
        </form>
        <div>
          <div className="row"><span>Excl. VAT</span><span className="num">{formatSar(totals.totalExcl)}</span></div>
          <div className="row"><span>VAT</span><span className="num">{formatSar(totals.totalVat)}</span></div>
          <div className="total">{formatSar(totals.totalIncl)} SAR</div>
        </div>
        <label>Cash received (blank = exact)</label>
        <input value={cash} onChange={(e) => setCash(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={busy || lines.length === 0} onClick={() => pay('cash')}>Cash</button>
          <button className="primary" disabled={busy || lines.length === 0} onClick={() => pay('card')}>Card</button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {lastSaleId !== null && (
          <button onClick={() => call('sale.print', { saleId: lastSaleId, copy: true }).catch((e: Error) => setMsg({ kind: 'error', text: e.message }))}>
            Reprint last receipt (copy)
          </button>
        )}
      </div>
    </div>
  );
}
