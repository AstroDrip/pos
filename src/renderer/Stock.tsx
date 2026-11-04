import { useEffect, useState } from 'react';
import { formatQty, formatSar, parseQty, parseSar } from '../core/money';
import type { Product } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { StockRow } from '../services/reports';
import { call } from './api';

interface GrnLine {
  product: Product;
  qty: string;
  cost: string;
}

export function Stock({ can }: { can: (p: string) => boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(0);
  const [reference, setReference] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [onlyLow, setOnlyLow] = useState(true);
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
    setMsg(null);
    try {
      const payload = {
        supplierId,
        reference: reference || undefined,
        lines: lines.map((l) => ({ productId: l.product.id, qty: parseQty(l.qty), unitCost: parseSar(l.cost) })),
      };
      const r = await call<{ grnNo: string }>('grn.create', payload);
      setMsg({ kind: 'ok', text: `Received ${r.grnNo}` });
      setLines([]);
      setReference('');
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="page row" style={{ alignItems: 'flex-start' }}>
      {can('stock.receive') && (
        <div className="card" style={{ margin: 0, maxWidth: 560 }}>
          <h3>Receive goods</h3>
          <label>Supplier</label>
          <select value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            <option value={0}>— choose —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label>Supplier invoice / delivery note no.</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
          <label>Add product</label>
          <input placeholder="Search name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((p) => (
            <button key={p.id} style={{ margin: 4 }} onClick={() => { setLines([...lines, { product: p, qty: '', cost: '' }]); setSearch(''); }}>
              {p.nameEn}
            </button>
          ))}
          <table className="list">
            <thead><tr><th>Product</th><th>Qty ({'pcs / kg'})</th><th>Unit cost excl. VAT</th><th /></tr></thead>
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
          <p><button className="primary" disabled={!supplierId || lines.length === 0} onClick={save}>Save receipt</button></p>
        </div>
      )}
      {can('reports.view') && (
        <div>
          <h3>Stock on hand</h3>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only at or below reorder level</label>
          <table className="list">
            <thead><tr><th>SKU</th><th>Product</th><th className="num">Qty</th><th className="num">Reorder at</th><th className="num">Avg cost</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} style={r.qty < 0 ? { color: 'var(--danger)' } : undefined}>
                  <td>{r.sku}</td><td>{r.nameEn}<div className="ar">{r.nameAr}</div></td>
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
