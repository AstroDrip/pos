import { useEffect, useRef, useState } from 'react';
import { formatQty, formatSar, parseQty, parseSar } from '../core/money';
import type { Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { StockRow } from '../services/reports';
import { call } from './api';
import { ProductName, useI18n } from './i18n';

interface GrnLine {
  product: Product;
  qty: string;
  cost: string;
}

export function Stock({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(0);
  const [reference, setReference] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [onlyLow, setOnlyLow] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => void call<Supplier[]>('supplier.list').then(setSuppliers), []);
  useEffect(() => {
    if (can('reports.view')) void call<StockRow[]>('report.stock', { onlyLow }).then(setRows);
  }, [onlyLow, msg, can]);
  useEffect(() => {
    if (search.trim()) void call<Product[]>('catalog.search', { text: search }).then(setFound);
    else setFound([]);
  }, [search]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        requestKey: requestKey.current,
        supplierId,
        reference: reference || undefined,
        lines: lines.map((l) => ({ productId: l.product.id, qty: parseQty(l.qty), unitCost: parseSar(l.cost) })),
      };
      const r = await call<{ grnNo: string }>('grn.create', payload);
      setMsg({ kind: 'ok', text: t('Received {0}', r.grnNo) });
      setLines([]);
      setReference('');
      requestKey.current = crypto.randomUUID(); // next delivery is a new receipt
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page row" style={{ alignItems: 'flex-start' }}>
      {can('stock.receive') && (
        <div className="card" style={{ margin: 0, maxWidth: 560 }}>
          <h3>{t('Receive goods')}</h3>
          <label>{t('Supplier')}</label>
          <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            <option value={0}>{t('— choose —')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label>{t('Supplier invoice / delivery note no.')}</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
          <label>{t('Add product')}</label>
          <input placeholder={t('Search name or SKU')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((p) => (
            <button key={p.id} style={{ margin: 4 }} onClick={() => { setLines([...lines, { product: p, qty: '', cost: '' }]); setSearch(''); }}>
              {p.nameEn}
            </button>
          ))}
          <table className="list">
            <thead><tr><th>{t('Product')}</th><th>Qty ({'pcs / kg'})</th><th>{t('Unit cost excl. VAT')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.product.nameEn}</td>
                  <td><input value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><input value={l.cost} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, cost: e.target.value } : x)))} /></td>
                  <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
          <p><button className="primary" disabled={saving || !supplierId || lines.length === 0} onClick={save}>{t('Save receipt')}</button></p>
        </div>
      )}
      {can('stock.adjust') && (
        <div>
          <AdjustCard kind="waste" onDone={() => setMsg(null)} />
          <AdjustCard kind="count" onDone={() => setMsg(null)} />
        </div>
      )}
      {can('reports.view') && (
        <div>
          <h3>{t('Stock on hand')}</h3>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> {t('Only at or below reorder level')}</label>
          <table className="list">
            <thead><tr><th>SKU</th><th>{t('Product')}</th><th className="num">{t('Qty')}</th><th className="num">{t('Reorder at')}</th><th className="num">{t('Avg cost')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} style={r.qty < 0 ? { color: 'var(--danger)' } : undefined}>
                  <td>{r.sku}</td><td><ProductName en={r.nameEn} ar={r.nameAr} /></td>
                  <td className="num">{formatQty(r.qty)}</td><td className="num">{formatQty(r.reorderLevel)}</td><td className="num">{formatSar(r.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const WASTE_REASONS = ['Expired', 'Damaged', 'Spoiled', 'Other'] as const;

interface AdjLine {
  product: Product;
  qty: string;
}

/**
 * Wastage (goods thrown away) or a stock count (stock set to what is on the shelf). The count is blind:
 * the counter does not see the system quantity, so they count what is really there.
 */
function AdjustCard({ kind, onDone }: { kind: 'waste' | 'count'; onDone: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<AdjLine[]>([]);
  const [reason, setReason] = useState(kind === 'waste' ? 'Expired' : '');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const requestKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (search.trim()) void call<Product[]>('catalog.search', { text: search }).then(setFound);
    else setFound([]);
  }, [search]);

  const reasonText = kind === 'waste' && reason === 'Other' ? other.trim() : reason.trim();

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const parsed = lines.map((l) => ({ productId: l.product.id, q: parseQty(l.qty) }));
      const r = await call<{ adjNo: string | null; changedLines: number; totalValue: number }>(
        kind === 'waste' ? 'stock.waste' : 'stock.count',
        kind === 'waste'
          ? { requestKey: requestKey.current, reason: reasonText, lines: parsed.map((l) => ({ productId: l.productId, qty: l.q })) }
          : { requestKey: requestKey.current, reason: reasonText, lines: parsed.map((l) => ({ productId: l.productId, countedQty: l.q })) },
      );
      setMsg({
        kind: 'ok',
        text: r.adjNo
          ? t('{0} saved: {1} products changed, value {2}', r.adjNo, r.changedLines, formatSar(r.totalValue))
          : t('Count matches the system: nothing changed'),
      });
      setLines([]);
      requestKey.current = crypto.randomUUID();
      onDone();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ margin: '0 0 12px 0', maxWidth: 480 }}>
      <h3>{kind === 'waste' ? t('Record wastage') : t('Stock count')}</h3>
      {kind === 'count' && <p style={{ opacity: 0.8 }}>{t('Count when the shop is closed. Enter what is on the shelf; stock is set to it.')}</p>}
      <label>{t('Reason')}</label>
      {kind === 'waste' ? (
        <>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {WASTE_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select>
          {reason === 'Other' && <input placeholder={t('Describe the reason')} value={other} onChange={(e) => setOther(e.target.value)} />}
        </>
      ) : (
        <input placeholder={t('e.g. Monthly count, aisle 3')} value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <label>{t('Add product')}</label>
      <input placeholder={t('Search name or SKU')} aria-label={`${kind} product search`} value={search} onChange={(e) => setSearch(e.target.value)} />
      {found.map((p) => (
        <button key={p.id} style={{ margin: 4 }} onClick={() => { if (!lines.some((l) => l.product.id === p.id)) setLines([...lines, { product: p, qty: '' }]); setSearch(''); }}>
          {p.nameEn}
        </button>
      ))}
      <table className="list">
        <thead><tr><th>{t('Product')}</th><th>{kind === 'waste' ? t('Qty thrown away') : t('Counted qty')} (pcs / kg)</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.product.id}>
              <td><ProductName en={l.product.nameEn} ar={l.product.nameAr} /></td>
              <td><input aria-label={`${kind} qty ${i + 1}`} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td><button className="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary" disabled={saving || lines.length === 0 || !reasonText || lines.some((l) => !l.qty.trim())} onClick={save}>{kind === 'waste' ? t('Save wastage') : t('Post count')}</button></p>
    </div>
  );
}
