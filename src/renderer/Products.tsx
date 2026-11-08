import { useEffect, useRef, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import type { Product } from '../services/catalog';
import { call } from './api';
import { PageHeader } from './PageHeader';
import { useSuggest } from './useSuggest';
import { ProductName, useI18n } from './i18n';

const PAGE = 100;
type Status = 'active' | 'inactive' | 'all';

const empty = { sku: '', nameAr: '', nameEn: '', sellMode: 'unit' as 'unit' | 'weight', vat: '15', price: '', barcode: '', plu: '' };

export function Products() {
  const { t } = useI18n();
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [status, setStatus] = useState<Status>('active');
  const [browse, setBrowse] = useState<{ items: Product[]; total: number }>({ items: [], total: 0 });
  const seq = useRef(0);
  const { items: found, refresh } = useSuggest<Product>(status === 'active' ? search : '', (q) => call<Product[]>('catalog.search', { text: q }));
  // With nothing typed, or when looking at turned-off items, the list comes page by page. Typing still uses the normal search.
  const browsing = status !== 'active' || !search.trim();
  const load = async (offset: number) => {
    const mine = ++seq.current;
    const r = await call<{ items: Product[]; total: number }>('catalog.list', { status, text: search.trim() || undefined, offset, limit: PAGE });
    if (mine === seq.current) setBrowse((b) => ({ items: offset === 0 ? r.items : [...b.items, ...r.items], total: r.total }));
  };
  const loadFailed = (e: Error) => setMsg({ kind: 'error', text: t(e.message) });
  useEffect(() => {
    if (!browsing) return;
    const h = setTimeout(() => void load(0).catch(loadFailed), search.trim() ? 150 : 0);
    return () => clearTimeout(h);
  }, [status, search, browsing]);
  const list = browsing ? browse.items : found;
  const reload = () => {
    refresh();
    if (browsing) void load(0).catch(loadFailed);
  };

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call('catalog.create', {
        sku: form.sku,
        nameAr: form.nameAr,
        nameEn: form.nameEn,
        unitCode: form.sellMode === 'weight' ? 'KG' : 'PCS',
        sellMode: form.sellMode,
        vatRateBp: parseSar(form.vat), // "15" -> 1500 basis points, same 2-decimal parsing as money
        priceIncl: parseSar(form.price),
        barcodes: form.barcode.trim() ? [form.barcode.trim()] : [],
        plu: form.plu.trim() || undefined,
      });
      setMsg({ kind: 'ok', text: t('Saved {0}', form.nameEn) });
      setForm(empty);
      refresh();
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('Products')} desc={t('Add products, change prices, other names for search, deactivate.')} />
      <div className="grid-cards">
      <form className="card" onSubmit={save}>
        <h3>{t('New product')}</h3>
        <label>SKU</label><input value={form.sku} onChange={set('sku')} />
        <label>{t('Name (Arabic)')}</label><input dir="rtl" value={form.nameAr} onChange={set('nameAr')} />
        <label>{t('Name (English)')}</label><input value={form.nameEn} onChange={set('nameEn')} />
        <label>{t('Sold by')}</label>
        <select value={form.sellMode} onChange={set('sellMode')}>
          <option value="unit">{t('Piece')}</option>
          <option value="weight">{t('Weight (kg)')}</option>
        </select>
        <label>{form.sellMode === 'weight' ? t('Shelf price incl. VAT (SAR per kg)') : t('Shelf price incl. VAT (SAR)')}</label>
        <input value={form.price} onChange={set('price')} />
        <label>{t('VAT %')}</label><input value={form.vat} onChange={set('vat')} />
        <label>{t('Barcode (optional)')}</label><input value={form.barcode} onChange={set('barcode')} />
        <label>{t('PLU (optional, needed for scale labels)')}</label><input value={form.plu} onChange={set('plu')} />
        {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
        <p><button className="primary">{t('Save product')}</button></p>
      </form>
      <div>
        <div className="row">
          <input data-kb-search="product" data-kb-suggest placeholder={t('Search products')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="product status" style={{ flex: '0 0 150px' }} value={status} onChange={(e) => { setEditing(null); setStatus(e.target.value as Status); }}>
            <option value="active">{t('Active')}</option>
            <option value="inactive">{t('Turned off')}</option>
            <option value="all">{t('All')}</option>
          </select>
        </div>
        {browsing && <p className="hint">{t('Showing {0} of {1}', browse.items.length, browse.total)}</p>}
        <table className="list" aria-label="products list">
          <thead><tr><th>SKU</th><th>{t('Name')}</th><th>{t('Sold by')}</th><th className="num">{t('Price')}</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: 'pointer' }}>
                <td>{p.sku}</td>
                <td><ProductName en={p.nameEn} ar={p.nameAr} />{!p.active && <small> · {t('Turned off')}</small>}</td>
                <td>{p.sellMode === 'weight' ? t('kg') : t('piece')}</td>
                <td className="num">{formatSar(p.priceIncl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {browsing && browse.items.length < browse.total && <p><button type="button" aria-label="show more products" onClick={() => void load(browse.items.length).catch(loadFailed)}>{t('Show more')}</button></p>}
        {editing && <EditProduct key={editing.id} product={editing} onDone={() => { setEditing(null); reload(); }} />}
      </div>
      </div>
    </div>
  );
}

function EditProduct({ product, onDone }: { product: Product; onDone: () => void }) {
  const { t } = useI18n();
  const [price, setPrice] = useState(formatSar(product.priceIncl));
  const [aliases, setAliases] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => void call<string[]>('catalog.aliases', { productId: product.id }).then((a) => setAliases(a.join(', '))), [product.id]);
  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  return (
    <div className="card section">
      <h3>{product.nameEn} · {product.sku}</h3>
      <label>{product.sellMode === 'weight' ? t('Shelf price incl. VAT (SAR per kg)') : t('Shelf price incl. VAT (SAR)')}</label>
      <div className="row">
        <input aria-label="new price" value={price} onChange={(e) => setPrice(e.target.value)} />
        <button onClick={() => run(() => call('catalog.setPrice', { productId: product.id, priceIncl: parseSar(price) }))}>{t('Save price')}</button>
      </div>
      <label>{t('Other names for search (comma-separated)')}</label>
      <div className="row">
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        <button onClick={() => run(() => call('catalog.setAliases', { productId: product.id, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) }))}>{t('Save names')}</button>
      </div>
      <label>{t('Reason')}</label>
      <div className="row">
        <input aria-label="status reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {product.active
          ? <button className="danger" onClick={() => run(() => call('catalog.setActive', { productId: product.id, active: false, reason }))}>{t('Deactivate product')}</button>
          : <button onClick={() => run(() => call('catalog.setActive', { productId: product.id, active: true, reason }))}>{t('Turn product back on')}</button>}
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button onClick={onDone}>{t('Close')}</button></p>
    </div>
  );
}
