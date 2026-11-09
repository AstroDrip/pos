import { useEffect, useState } from 'react';
import type { StoreDetails } from '../services/store-details';
import { call } from './api';
import { InfoIcon } from './InfoIcon';
import { useI18n } from './i18n';

type Msg = { kind: 'ok' | 'error'; text: string } | null;
const MAX_LOGO = 200 * 1024;

/** Admin: the store's own details, printed on every receipt. */
export function StoreDetailsCard() {
  const { t } = useI18n();
  const [d, setD] = useState<StoreDetails | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void call<StoreDetails>('store.get').then(setD, (e: Error) => setMsg({ kind: 'error', text: t(e.message) })), []);
  if (!d) return msg ? <div className="card section"><p className={`msg ${msg.kind}`}>{msg.text}</p></div> : null;

  const field = (k: keyof StoreDetails, label: string) => (
    <div key={k}>
      <label>{label} <InfoIcon id={`field.store.${k}`} /></label>
      <input aria-label={`store ${k}`} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </div>
  );
  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_LOGO) return setMsg({ kind: 'error', text: t('The logo must be a PNG or JPEG file of 200 KB or less') });
    const r = new FileReader();
    r.onload = () => {
      setMsg(null);
      setD({ ...d, logo: String(r.result) });
    };
    r.readAsDataURL(file);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await call('store.save', d);
      setMsg({ kind: 'ok', text: t('Store details saved.') });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card section" role="region" aria-label="store details">
      <h3>{t('Store details')}</h3>
      <p className="hint">{t('Printed on every receipt.')}</p>
      {field('nameAr', t('Store name (Arabic)'))}
      {field('nameEn', t('Store name (English)'))}
      {field('legalNameAr', t('Legal name (Arabic)'))}
      {field('legalNameEn', t('Legal name (English)'))}
      {field('vatNumber', t('VAT number'))}
      {field('crNumber', t('CR number'))}
      {field('mobile', t('Mobile'))}
      {field('addressLine', t('Address as printed on the receipt'))}
      <h4>{t('National address')}</h4>
      {field('buildingNo', t('Building number'))}
      {field('street', t('Street'))}
      {field('district', t('District'))}
      {field('city', t('City'))}
      {field('postalCode', t('Postal code'))}
      {field('additionalNo', t('Additional number'))}
      <h4>{t('Receipt footer')}</h4>
      {field('footerAr', t('Thank-you line (Arabic)'))}
      {field('footerEn', t('Thank-you line (English)'))}
      <label>{t('Logo (PNG or JPEG, up to 200 KB)')} <InfoIcon id="field.store.logo" /></label>
      <input type="file" aria-label="store logo" accept="image/png,image/jpeg" onChange={(e) => pickLogo(e.target.files?.[0])} />
      {d.logo && <button type="button" onClick={() => setD({ ...d, logo: '' })}>{t('Remove logo')}</button>}
      <h4>{t('Preview')}</h4>
      <div className="receipt-preview" aria-label="receipt preview">
        {d.logo && <img src={d.logo} alt="" />}
        <strong dir="rtl">{d.nameAr}</strong>
        <strong>{d.nameEn}</strong>
        <span dir="rtl">{d.legalNameAr}</span>
        <span>{d.legalNameEn}</span>
        <span dir="rtl">{d.addressLine}</span>
        <span>{t('VAT number')}: {d.vatNumber || '—'}</span>
        {d.crNumber && <span>{t('CR number')}: {d.crNumber}</span>}
        {d.mobile && <span>{t('Mobile')}: {d.mobile}</span>}
      </div>
      {msg && <p className={`msg ${msg.kind}`} role="status">{msg.text}</p>}
      <p><button className="primary" disabled={busy} onClick={() => void save()}>{t('Save store details')}</button></p>
    </div>
  );
}
