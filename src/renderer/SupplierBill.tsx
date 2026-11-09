import { useEffect, useMemo, useRef, useState } from 'react';
import { billWarnings, type BillWarning } from '../core/bill-warnings';
import { MILLI_PER_UNIT, formatSar, parseQty, parseSar, roundDiv } from '../core/money';
import { storeDay } from '../core/store-time';
import { computeBill, type BillLineInput, type BillLineResult } from '../core/supplier-bill';
import { vatFromInclusive } from '../core/vat';
import type { LookupResult, Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { DocType, SupplierItem } from '../services/supplier-bills';
import { singleMatch } from '../core/suggest-keys';
import { call, type ApiError } from './api';
import { InfoIcon } from './InfoIcon';
import { HelpLink } from './HelpLink';
import { ProductName, useI18n } from './i18n';
import { useSuggest } from './useSuggest';

const DRAFT = 'pos.billDraft';
const today = () => storeDay(new Date().toISOString());
type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

interface Row {
  uid: string;
  product: Product;
  avgCost: number;
  hasStock: boolean;
  code: string;
  billText: string;
  tariff: string;
  packName: string;
  units: string;
  packs: string;
  loose: string;
  free: string;
  received: string;
  basis: 'pack' | 'unit';
  price: string;
  discount: string;
  discountIsPct: boolean;
  vatPct: string;
  vatPrinted: string;
  page: string;
}

const blankHead = () => ({
  supplierId: 0, docType: 'tax_invoice' as DocType, docNo: '', docDate: today(), deliveryDate: today(), salesAgent: '', payType: '' as '' | 'paid' | 'credit', payMethod: 'till' as 'till' | 'bank',
  paidNow: '', dueDate: '', noDue: false, claim: null as boolean | null, vatNo: '', pages: '1', billDiscount: '', billCharge: '', reason: '', notes: '', notSame: false,
});
const blankPaper = () => ({ gross: '', discount: '', net: '', vat: '', total: '' });
type Head = ReturnType<typeof blankHead>;
type Paper = ReturnType<typeof blankPaper>;
interface Draft { key: string; head: Head; paper: Paper; rows: Row[] }

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

const sarOf = (s: string, blank = 0) => {
  if (!s.trim()) return blank;
  try {
    return parseSar(s);
  } catch {
    return NaN;
  }
};
const qtyOf = (s: string) => {
  if (!s.trim()) return 0;
  try {
    return parseQty(s);
  } catch {
    return NaN;
  }
};

/** The line as the maths needs it, or null while something typed is not a number. */
function toLine(r: Row): BillLineInput | null {
  const packs = r.packs.trim() ? Number(r.packs) : 0;
  const received = r.received.trim() ? qtyOf(r.received) : undefined;
  const discount = sarOf(r.discount);
  const vatRateBp = sarOf(r.vatPct); // "15" reads as 1500, which is 15% in basis points
  const vatOverride = r.vatPrinted.trim() ? sarOf(r.vatPrinted) : undefined;
  const line: BillLineInput = {
    unitsPerPack: qtyOf(r.units), packs, looseQty: qtyOf(r.loose), freeQty: qtyOf(r.free), receivedQty: received, priceBasis: r.basis, price: sarOf(r.price),
    ...(r.discountIsPct ? { discountBp: discount } : { discountAmount: discount }), vatRateBp, vatOverride,
  };
  const numbers = [line.unitsPerPack, line.packs, line.looseQty, line.freeQty, line.price, discount, vatRateBp, received ?? 0, vatOverride ?? 0];
  return numbers.every((n) => Number.isSafeInteger(n)) ? line : null;
}

export function SupplierBill({ suppliers, can }: { suppliers: Supplier[]; can: (p: string) => boolean }) {
  const { t, lang } = useI18n();
  const [head, setHead] = useState<Head>(blankHead());
  const [paper, setPaper] = useState<Paper>(blankPaper());
  const [rows, setRows] = useState<Row[]>([]);
  const requestKey = useRef<string>(crypto.randomUUID());
  const draftLoaded = useRef(false);
  useEffect(() => {
    void (async () => {
      let d: Draft | null;
      try {
        const saved = await call<{ json: string } | null>('draft.get', { kind: 'supplier_bill' });
        d = saved ? (JSON.parse(saved.json) as Draft) : readDraft(); // a draft from before drafts were kept per user
      } catch {
        d = readDraft();
      }
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        // nothing to clear
      }
      if (d) {
        setHead(d.head);
        setPaper(d.paper);
        setRows(d.rows);
        requestKey.current = d.key;
      }
      draftLoaded.current = true;
    })();
  }, []);
  const [items, setItems] = useState<SupplierItem[]>([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [creating, setCreating] = useState<{ nameAr: string; nameEn: string; sku: string; barcode: string; unit: 'PCS' | 'KG'; price: string } | null>(null);
  const [needConfirm, setNeedConfirm] = useState(false);
  const { items: found, itemsFor } = useSuggest<Product>(search, (q) => call<Product[]>('catalog.search', { text: q }));
  const set = (patch: Partial<Head>) => setHead((h) => ({ ...h, ...patch }));
  const delivery = head.docType === 'delivery_note';
  const supplier = suppliers.find((s) => s.id === head.supplierId);

  useEffect(() => {
    if (!head.supplierId) return setItems([]);
    void call<SupplierItem[]>('bill.items', { supplierId: head.supplierId }).then(setItems, () => setItems([]));
  }, [head.supplierId]);

  useEffect(() => {
    if (!draftLoaded.current) return undefined;
    const h = setTimeout(() => {
      if (head.docNo || rows.length) void call('draft.save', { kind: 'supplier_bill', json: JSON.stringify({ key: requestKey.current, head, paper, rows }) }).catch(() => undefined);
      else void call('draft.clear', { kind: 'supplier_bill' }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(h);
  }, [head, paper, rows]);

  const addRow = async (product: Product, known?: SupplierItem, code = '') => {
    const item = known ?? items.find((i) => i.productId === product.id);
    const cost = await call<{ avgCost: number; stockQty: number }>('bill.productCost', { productId: product.id }).catch(() => ({ avgCost: 0, stockQty: 0 }));
    setRows((r) => [...r, {
      uid: crypto.randomUUID(), product, avgCost: cost.avgCost, hasStock: cost.stockQty > 0, code: item?.supplierCode ?? code, billText: '', tariff: '', packName: item?.packName ?? 'PCS',
      units: item ? String(item.unitsPerPack / MILLI_PER_UNIT) : '1', packs: '', loose: '', free: '', received: '', basis: 'pack', price: item ? formatSar(item.lastPrice) : '', discount: '', discountIsPct: false,
      vatPct: String(product.vatRateBp / 100), vatPrinted: '', page: String(Math.max(1, Number(head.pages) || 1)),
    }]);
    setSearch('');
    setCreating(null);
    setChecked(false);
  };
  const lookup = async () => {
    const text = search.trim();
    if (!text) return;
    setMsg(null);
    try {
      if (head.supplierId) {
        const item = await call<SupplierItem | null>('bill.item', { supplierId: head.supplierId, code: text });
        if (item) return void addRow(item.product, item);
      }
      const r = await call<LookupResult | null>('catalog.lookup', { code: text });
      if (r) return void addRow(r.product, undefined, /^\d+$/.test(text) ? '' : text);
      const only = singleMatch(found, itemsFor, text);
      if (only) return void addRow(only, undefined, '');
      setMsg({ kind: 'warn', text: found.length ? t('Choose the item from the list.') : t('Not found: {0}', text) });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  const createProduct = async () => {
    if (!creating) return;
    setMsg(null);
    try {
      await call('catalog.create', {
        sku: creating.sku, nameAr: creating.nameAr, nameEn: creating.nameEn, unitCode: creating.unit, sellMode: creating.unit === 'KG' ? 'weight' : 'unit', vatRateBp: 1500, priceIncl: sarOf(creating.price),
        barcodes: creating.barcode ? [creating.barcode] : undefined,
      });
      const hits = await call<Product[]>('catalog.search', { text: creating.sku });
      const p = hits.find((h) => h.sku === creating.sku);
      if (p) await addRow(p, undefined, /^\d+$/.test(search.trim()) ? '' : search.trim());
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  const edit = (uid: string, patch: Partial<Row>) => {
    setRows((r) => r.map((x) => (x.uid === uid ? { ...x, ...patch } : x)));
    setChecked(false);
  };

  const calc = useMemo(() => {
    const lines = rows.map(toLine);
    const billDiscount = sarOf(head.billDiscount);
    const billCharge = sarOf(head.billCharge);
    if (lines.length === 0 || lines.some((l) => !l) || Number.isNaN(billDiscount) || Number.isNaN(billCharge)) return null;
    try {
      return computeBill(lines as BillLineInput[], billDiscount, billCharge);
    } catch (e) {
      return (e as Error).message;
    }
  }, [rows, head.billDiscount, head.billCharge]);
  const totals = calc && typeof calc !== 'string' ? calc : null;

  const warningsFor = (r: Row, l: BillLineResult): BillWarning[] =>
    billWarnings({ costPerUnit: roundDiv(l.net * MILLI_PER_UNIT, l.costQty), avgCost: r.avgCost, shelfExcl: r.product.priceIncl - vatFromInclusive(r.product.priceIncl, r.product.vatRateBp), hasStock: r.hasStock });
  const anyWarning = !!totals && rows.some((r, i) => warningsFor(r, totals.lines[i]!).length > 0);
  const short = !!totals && !delivery && totals.lines.some((l) => l.stockQty < l.costQty);

  const compare = [
    { key: 'gross', label: t('Gross'), line: totals?.gross, paper: paper.gross, required: false },
    { key: 'discount', label: t('Discount'), line: totals?.discount, paper: paper.discount, required: false },
    { key: 'net', label: t('Net, excl. VAT'), line: totals?.net, paper: paper.net, required: true },
    { key: 'vat', label: t('VAT'), line: totals?.vat, paper: paper.vat, required: true },
    { key: 'total', label: t('Total'), line: totals?.total, paper: paper.total, required: true },
  ] as const;
  const matched = (c: (typeof compare)[number]) => (c.paper.trim() ? sarOf(c.paper) === c.line : !c.required);
  const allMatch = !!totals && compare.every(matched);
  const claimDefault = head.docType === 'tax_invoice';
  const claim = head.claim ?? claimDefault;
  const ready = !!head.supplierId && !!head.docNo.trim() && !!totals && allMatch && (delivery || !!head.payType) && (!anyWarning || checked) && (!short || !!head.reason.trim()) && !Number.isNaN(sarOf(head.paidNow));

  const startOver = () => {
    if (!window.confirm(t('Clear this bill and start over?'))) return;
    void call('draft.clear', { kind: 'supplier_bill' }).catch(() => undefined);
    requestKey.current = crypto.randomUUID();
    setHead(blankHead());
    setPaper(blankPaper());
    setRows([]);
    setChecked(false);
    setNeedConfirm(false);
    setMsg(null);
  };

  const save = async () => {
    if (busy || !totals) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ grnNo: string; pinvNo: string | null }>('bill.create', {
        requestKey: requestKey.current, supplierId: head.supplierId, docType: head.docType, docNo: head.docNo, docDate: head.docDate, deliveryDate: head.deliveryDate || undefined, salesAgent: head.salesAgent || undefined,
        payType: head.payType || 'credit', payMethod: head.payMethod, paidNow: head.payType === 'credit' && sarOf(head.paidNow) > 0 ? sarOf(head.paidNow) : undefined, dueDate: head.dueDate || undefined, noDueDate: head.noDue || undefined,
        claimVat: claim, pages: Math.max(1, Number(head.pages) || 1), billDiscount: sarOf(head.billDiscount), billCharge: sarOf(head.billCharge),
        paper: { gross: paper.gross.trim() ? sarOf(paper.gross) : undefined, discount: paper.discount.trim() ? sarOf(paper.discount) : undefined, net: sarOf(paper.net), vat: sarOf(paper.vat), total: sarOf(paper.total) },
        differenceReason: head.reason || undefined, supplierVatNo: head.vatNo || undefined, notes: head.notes || undefined, notSameGoods: head.notSame || undefined,
        lines: rows.map((row) => ({ ...(toLine(row) as BillLineInput), productId: row.product.id, supplierCode: row.code || undefined, billText: row.billText || undefined, tariffCode: row.tariff || undefined, packName: row.packName, pageNo: Math.max(1, Number(row.page) || 1) })),
      });
      setMsg({ kind: 'ok', text: r.pinvNo ? t('Saved. Goods receipt {0}, invoice {1}.', r.grnNo, r.pinvNo) : t('Saved. Goods receipt {0}. Nothing is owed until the invoice comes.', r.grnNo) });
      void call('draft.clear', { kind: 'supplier_bill' }).catch(() => undefined);
      requestKey.current = crypto.randomUUID();
      setHead(blankHead());
      setPaper(blankPaper());
      setRows([]);
      setChecked(false);
      setNeedConfirm(false);
    } catch (e) {
      if ((e as ApiError).code === 'POSSIBLE_DUPLICATE') setNeedConfirm(true);
      setMsg({ kind: 'error', text: t((e as Error).message) }); // the same key is kept, so saving again is safe
    } finally {
      setBusy(false);
    }
  };

  const num = (label: string, aria: string, value: string, onChange: (v: string) => void, width = 76) => (
    <div style={{ width }}><label>{label} <InfoIcon id={`field.bill.line.${aria.split(' ').slice(0, -1).join('')}`} /></label><input aria-label={aria} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} /></div>
  );

  return (
    <div className="bill">
      <div className="card section bill-card">
        <h3>{t('Enter supplier bill')} <HelpLink article="suppliers-enter-bill" /></h3>
        <div className="bill-fields">
          <div><label>{t('Supplier')} <InfoIcon id="field.purchase.supplier" /></label>
            <select aria-label="bill supplier" value={head.supplierId} onChange={(e) => {
              const s = suppliers.find((x) => x.id === Number(e.target.value));
              set({ supplierId: Number(e.target.value), salesAgent: s?.salesman ?? '', vatNo: '' });
            }}>
              <option value={0}>—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label>{t('Paper type')} <InfoIcon id="field.bill.type" /></label>
            <select aria-label="paper type" value={head.docType} onChange={(e) => set({ docType: e.target.value as DocType, claim: null })}>
              <option value="tax_invoice">{t('Tax invoice')}</option>
              <option value="delivery_note">{t('Delivery note')}</option>
              <option value="proforma">{t('Proforma invoice')}</option>
              <option value="other">{t('Other paper')}</option>
            </select>
          </div>
          <div><label>{t('Number on the paper')} <InfoIcon id="field.bill.number" /></label><input aria-label="paper number" value={head.docNo} onChange={(e) => set({ docNo: e.target.value })} /></div>
          <div><label>{t('Paper date')} <InfoIcon id="field.bill.date" /></label><input type="date" aria-label="paper date" value={head.docDate} onChange={(e) => set({ docDate: e.target.value })} /></div>
          <div><label>{t('Delivery date')} <InfoIcon id="field.bill.delivery" /></label><input type="date" value={head.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} /></div>
          <div><label>{t('Sales agent')} <InfoIcon id="field.bill.agent" /></label><input value={head.salesAgent} onChange={(e) => set({ salesAgent: e.target.value })} /></div>
          <div><label>{t('Pages')} <InfoIcon id="field.bill.pages" /></label><input aria-label="pages" inputMode="numeric" value={head.pages} onChange={(e) => set({ pages: e.target.value })} /></div>
          {!delivery && <div><label>{t('Supplier VAT number')} <InfoIcon id="field.bill.vatNo" /></label><input aria-label="supplier vat" placeholder={supplier?.vatNumber ?? ''} value={head.vatNo} onChange={(e) => set({ vatNo: e.target.value })} /></div>}
        </div>
        {delivery ? <p className="msg warn">{t('A delivery note brings the goods in. Nothing is owed until the invoice comes.')}</p> : (
          <>
            <div className="bill-fields" role="group" aria-label="paid or credit">
              <div><label>{t('The paper says')} <InfoIcon id="field.bill.says" /></label>
                <div className="seg">
                  <button type="button" aria-label="mark paid" className={head.payType === 'paid' ? 'on' : ''} onClick={() => set({ payType: 'paid' })}>{t('Paid')}</button>
                  <button type="button" aria-label="mark credit" className={head.payType === 'credit' ? 'on' : ''} onClick={() => set({ payType: 'credit' })}>{t('Credit')}</button>
                </div>
              </div>
              {head.payType === 'paid' && <div><label>{t('Paid from')} <InfoIcon id="field.bill.paidFrom" /></label>
                <select aria-label="paid from" value={head.payMethod} onChange={(e) => set({ payMethod: e.target.value as 'till' | 'bank' })}>
                  <option value="till">{t('Till cash (open shift)')}</option><option value="bank">{t('Bank')}</option>
                </select></div>}
              {head.payType === 'credit' && (
                <>
                  <div><label>{t('Due date (blank = supplier terms)')} <InfoIcon id="field.bill.due" /></label><input type="date" value={head.dueDate} disabled={head.noDue} onChange={(e) => set({ dueDate: e.target.value })} /></div>
                  <div><label>{t('Part paid now (SAR)')} <InfoIcon id="field.bill.partPaid" /></label><input aria-label="part paid" value={head.paidNow} onChange={(e) => set({ paidNow: e.target.value })} /></div>
                  {sarOf(head.paidNow) > 0 && <div><label>{t('Paid from')} <InfoIcon id="field.bill.paidFrom" /></label>
                    <select value={head.payMethod} onChange={(e) => set({ payMethod: e.target.value as 'till' | 'bank' })}>
                      <option value="till">{t('Till cash (open shift)')}</option><option value="bank">{t('Bank')}</option>
                    </select></div>}
                  <label className="bill-check"><input type="checkbox" checked={head.noDue} onChange={(e) => set({ noDue: e.target.checked })} /> {t('No due date (informal credit)')} <InfoIcon id="field.purchase.noDue" /></label>
                </>
              )}
            </div>
            <label className="bill-check"><input type="checkbox" aria-label="claim vat" checked={claim} onChange={(e) => set({ claim: e.target.checked })} /> {t('Claim this VAT back (needs a real tax invoice)')} <InfoIcon id="field.vat.recoverable" /></label>
          </>
        )}
      </div>

      <div className="card section bill-card">
        <h3>{t('Lines')}</h3>
        <label>{t('Add a line: supplier code, barcode or name, then Enter')} <InfoIcon id="field.bill.add" /></label>
        <input data-kb-search="product" data-kb-suggest aria-label="bill product search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void lookup();
          }
        }} />
        <div>
          {found.slice(0, 8).map((p) => <button key={p.id} type="button" style={{ margin: 4 }} onClick={() => void addRow(p)}>{lang === 'ar' ? p.nameAr : p.nameEn}</button>)}
          {search.trim() && can('product.manage') && !creating && <button type="button" style={{ margin: 4 }} onClick={() => setCreating({ nameAr: '', nameEn: '', sku: /^\d+$/.test(search.trim()) ? '' : search.trim(), barcode: /^\d+$/.test(search.trim()) ? search.trim() : '', unit: 'PCS', price: '' })}>{t('New product')}</button>}
        </div>
        {creating && (
          <div className="subpanel bill-fields" role="group" aria-label="new product">
            <div><label>{t('Name (Arabic)')} <InfoIcon id="field.product.nameAr" /></label><input aria-label="new product arabic" value={creating.nameAr} onChange={(e) => setCreating({ ...creating, nameAr: e.target.value })} /></div>
            <div><label>{t('Name (English)')} <InfoIcon id="field.product.nameEn" /></label><input aria-label="new product english" value={creating.nameEn} onChange={(e) => setCreating({ ...creating, nameEn: e.target.value })} /></div>
            <div><label>{t('SKU')} <InfoIcon id="field.bill.sku" /></label><input aria-label="new product sku" value={creating.sku} onChange={(e) => setCreating({ ...creating, sku: e.target.value })} /></div>
            <div><label>{t('Barcode')} <InfoIcon id="field.bill.barcode" /></label><input value={creating.barcode} onChange={(e) => setCreating({ ...creating, barcode: e.target.value })} /></div>
            <div><label>{t('Sold by')} <InfoIcon id="field.product.sellMode" /></label><select value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value as 'PCS' | 'KG' })}><option value="PCS">{t('Piece')}</option><option value="KG">{t('kg')}</option></select></div>
            <div><label>{t('Shelf price incl. VAT (SAR)')} <InfoIcon id="field.product.price" /></label><input aria-label="new product price" value={creating.price} onChange={(e) => setCreating({ ...creating, price: e.target.value })} /></div>
            <button type="button" className="primary" disabled={!creating.nameAr.trim() || !creating.nameEn.trim() || !creating.sku.trim() || Number.isNaN(sarOf(creating.price))} onClick={() => void createProduct()}>{t('Add product')}</button>
            <button type="button" onClick={() => setCreating(null)}>{t('Cancel')}</button>
          </div>
        )}
        {rows.map((r, i) => {
          const l = totals?.lines[i];
          const w = l ? warningsFor(r, l) : [];
          return (
            <div key={r.uid} className="bill-line" role="group" aria-label={`bill line ${i + 1}`}>
              <div className="bill-line-head">
                <strong>{i + 1}.</strong> <ProductName en={r.product.nameEn} ar={r.product.nameAr} />
                <button type="button" className="danger" aria-label={`remove bill line ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.uid !== r.uid))}>✕</button>
              </div>
              <div className="bill-line-fields">
                {num(t('Code'), `code ${i + 1}`, r.code, (v) => edit(r.uid, { code: v }), 96)}
                {num(t('Pack name'), `pack name ${i + 1}`, r.packName, (v) => edit(r.uid, { packName: v }))}
                {num(t('Pieces in pack'), `pieces in pack ${i + 1}`, r.units, (v) => edit(r.uid, { units: v }))}
                {num(t('Packs'), `packs ${i + 1}`, r.packs, (v) => edit(r.uid, { packs: v }))}
                {num(t('Loose'), `loose ${i + 1}`, r.loose, (v) => edit(r.uid, { loose: v }))}
                {num(t('Free'), `free ${i + 1}`, r.free, (v) => edit(r.uid, { free: v }))}
                {num(t('Received'), `received ${i + 1}`, r.received, (v) => edit(r.uid, { received: v }))}
                <div style={{ width: 96 }}><label>{t('Price per')} <InfoIcon id="field.bill.priceIs" /></label>
                  <select aria-label={`price basis ${i + 1}`} value={r.basis} onChange={(e) => edit(r.uid, { basis: e.target.value as 'pack' | 'unit' })}><option value="pack">{t('Pack')}</option><option value="unit">{t('Piece')}</option></select>
                </div>
                {num(t('Price'), `price ${i + 1}`, r.price, (v) => edit(r.uid, { price: v }), 88)}
                {num(t('Discount'), `discount ${i + 1}`, r.discount, (v) => edit(r.uid, { discount: v }))}
                <div style={{ width: 64 }}><label>{t('As')} <InfoIcon id="field.bill.taxAs" /></label>
                  <select aria-label={`discount type ${i + 1}`} value={r.discountIsPct ? 'pct' : 'sar'} onChange={(e) => edit(r.uid, { discountIsPct: e.target.value === 'pct' })}><option value="sar">{t('SAR')}</option><option value="pct">%</option></select>
                </div>
                {num(t('VAT %'), `vat percent ${i + 1}`, r.vatPct, (v) => edit(r.uid, { vatPct: v }), 60)}
                {num(t('VAT printed'), `vat printed ${i + 1}`, r.vatPrinted, (v) => edit(r.uid, { vatPrinted: v }))}
                {num(t('Page'), `page ${i + 1}`, r.page, (v) => edit(r.uid, { page: v }), 52)}
                {num(t('Tariff no.'), `tariff ${i + 1}`, r.tariff, (v) => edit(r.uid, { tariff: v }), 110)}
                {num(t('Name on the paper'), `paper name ${i + 1}`, r.billText, (v) => edit(r.uid, { billText: v }), 180)}
              </div>
              {l && <div className="bill-line-sum num" aria-label={`line result ${i + 1}`}>{t('Net')} {formatSar(l.net)} · {t('VAT')} {formatSar(l.vat)} · {t('Total')} {formatSar(l.total)} · {t('Cost per piece')} {formatSar(roundDiv(l.net * MILLI_PER_UNIT, l.costQty))}</div>}
              {w.includes('above_shelf') && <p className="msg warn">{t('Cost is above the shelf price. Check the pack size and price.')}</p>}
              {w.includes('far_from_average') && <p className="msg warn">{t('Cost is far from the usual cost {0}. Check the pack size and price.', formatSar(r.avgCost))}</p>}
            </div>
          );
        })}
        <div className="bill-fields">
          <div><label>{t('Discount on the whole bill (SAR)')} <InfoIcon id="field.bill.discount" /></label><input aria-label="bill discount" value={head.billDiscount} onChange={(e) => set({ billDiscount: e.target.value })} /></div>
          <div><label>{t('Delivery or other charge (SAR)')} <InfoIcon id="field.bill.charge" /></label><input aria-label="bill charge" value={head.billCharge} onChange={(e) => set({ billCharge: e.target.value })} /></div>
        </div>
      </div>

      <div className="card section bill-card">
        <h3>{t('Check against the paper')}</h3>
        {typeof calc === 'string' && <p className="msg error">{t(calc)}</p>}
        <table className="list" aria-label="paper totals">
          <thead><tr><th /><th className="num">{t('Lines add up to')}</th><th className="num">{t('On the paper')}</th><th className="num">{t('Gap')}</th></tr></thead>
          <tbody>
            {compare.map((c) => (
              <tr key={c.key}>
                <td>{c.label}{!c.required && <small> ({t('optional')})</small>}</td>
                <td className="num">{c.line === undefined ? '—' : formatSar(c.line)}</td>
                <td className="num"><input aria-label={`paper ${c.key}`} style={{ width: 110 }} value={c.paper} onChange={(e) => setPaper({ ...paper, [c.key]: e.target.value })} /></td>
                <td className={`num${c.paper.trim() && !matched(c) ? ' neg' : ''}`}>{c.paper.trim() && c.line !== undefined && !Number.isNaN(sarOf(c.paper)) ? formatSar(sarOf(c.paper) - c.line) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {short && <><label>{t('Reason for the difference')} <InfoIcon id="field.bill.reason" /></label><input aria-label="difference reason" value={head.reason} placeholder={t('Short delivery')} onChange={(e) => set({ reason: e.target.value })} /></>}
        <label>{t('Notes')} <InfoIcon id="field.bill.notes" /></label><input value={head.notes} onChange={(e) => set({ notes: e.target.value })} />
        {anyWarning && <label className="bill-check"><input type="checkbox" aria-label="costs checked" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {t('I checked the costs marked above')}</label>}
        {msg && <p className={`msg ${msg.kind}`} role="status">{msg.text}</p>}
        {needConfirm && <label className="bill-check"><input type="checkbox" aria-label="different goods" checked={head.notSame} onChange={(e) => set({ notSame: e.target.checked })} /> {t('I checked: these are different goods')}</label>}
        <p className="row">
          <button className="primary" aria-label="save bill" disabled={busy || !ready || (needConfirm && !head.notSame)} onClick={() => void save()}>{t('Save bill')}</button>
          <button type="button" aria-label="start over" disabled={busy} onClick={startOver}>{t('Start over')}</button>
        </p>
      </div>
    </div>
  );
}
