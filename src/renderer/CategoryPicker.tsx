import { useEffect, useState } from 'react';
import type { ProductCategory } from '../services/catalog';
import { call } from './api';
import { useI18n } from './i18n';
import { InfoIcon } from './InfoIcon';

/** Pick a product's category, or add a new one without leaving the form. */
export function CategoryPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<ProductCategory[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => call<ProductCategory[]>('catalog.categories', null).then(setList);
  useEffect(() => void load(), []);

  const add = async () => {
    setError(null);
    try {
      const id = await call<number>('catalog.addCategory', { name });
      setName('');
      await load();
      onChange(id);
    } catch (e) {
      setError(t((e as Error).message));
    }
  };

  return (
    <>
      <div className="wide">
        <label>{t('Category')} <InfoIcon id="field.product.category" /></label>
        <select aria-label="category" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('No category')}</option>
          {list.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </select>
      </div>
      <div className="wide">
        <label>{t('New category')} <InfoIcon id="field.product.newCategory" /></label>
        <div className="row">
          <input aria-label="new category" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button type="button" disabled={!name.trim()} onClick={() => void add()}>{t('Add category')}</button>
        </div>
        {error && <p className="msg error">{error}</p>}
      </div>
    </>
  );
}
