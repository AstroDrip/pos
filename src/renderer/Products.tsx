import { useEffect, useState } from 'react';
import { formatSar, parseSar } from '../core/money';
import type { Product } from '../services/catalog';
import { call } from './api';
import { ProductName, useI18n } from './i18n';

const empty = { sku: '', nameAr: '', nameEn: '', sellMode: 'unit' as 'unit' | 'weight', vat: '15', price: '', barcode: '', plu: '' };

export function Products() {
  const { t } = useI18n();
  const [form, setForm] = useState(empty);
  const [list, setList] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = (text: string) => call<Product[]>('catalog.search', { text }).then(setList);
  useEffect(() => void load(search), [search]);

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
      void load(search);
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };

  return (
    <div className="page row" style={{ alignItems: 'flex-start' }}>
      <form className="card" style={{ margin: 0 }} onSubmit={save}>
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
        <input placeholder={t('Search products')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <table className="list">
          <thead><tr><th>SKU</th><th>{t('Name')}</th><th>{t('Sold by')}</th><th className="num">{t('Price')}</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td><ProductName en={p.nameEn} ar={p.nameAr} /></td>
                <td>{p.sellMode === 'weight' ? t('kg') : t('piece')}</td>
                <td className="num">{formatSar(p.priceIncl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
