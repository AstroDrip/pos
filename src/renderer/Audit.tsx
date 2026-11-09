import { useEffect, useState } from 'react';
import { storeDateTime } from '../core/store-time';
import type { AuditFilterChoices, AuditView } from '../services/audit-view';
import type { ItemInfo } from '../services/catalog';
import { call } from './api';
import { DateNavigator, useDateRange } from './DateNavigator';
import { HelpLink } from './HelpLink';
import { useI18n } from './i18n';
import { formatSar } from '../core/money';
import { EmptyRow, PageHeader } from './PageHeader';
import { useReturnTick } from './TabHost';

const PAGE = 100;
const BLANK = { text: '', userId: 0, from: '', to: '', action: '', entity: '' };
type Filters = typeof BLANK;

const payload = (f: Filters) => ({
  ...(f.text.trim() ? { text: f.text.trim() } : {}),
  ...(f.userId ? { userId: f.userId } : {}),
  ...(f.from ? { from: f.from } : {}),
  ...(f.to ? { to: f.to } : {}),
  ...(f.action ? { action: f.action } : {}),
  ...(f.entity ? { entity: f.entity } : {}),
});

/** Who did what and when. Read only: nothing here can change or remove a record. */
export function Audit({ can, openSale, openCustomer, books }: {
  can: (p: string) => boolean;
  openSale: (invoiceNo: string) => void;
  openCustomer: (id: number) => void;
  books?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<'log' | 'books'>('log');
  return (
    <div className="page">
      <PageHeader
        title={t('Audit')}
        desc={t('Who did what and when. Nothing here can be changed or removed.')}
        actions={<><HelpLink article="audit-log" />{books ? (
          <div className="seg" role="group" aria-label="audit section">
            <button className={section === 'log' ? 'on' : ''} onClick={() => setSection('log')}>{t('Activity log')}</button>
            <button className={section === 'books' ? 'on' : ''} onClick={() => setSection('books')}>{t('Books check')}</button>
          </div>
        ) : null}</>}
      />
      {section === 'log' ? <ActivityLog can={can} openSale={openSale} openCustomer={openCustomer} /> : books}
    </div>
  );
}

function ActivityLog({ can, openSale, openCustomer }: { can: (p: string) => boolean; openSale: (invoiceNo: string) => void; openCustomer: (id: number) => void }) {
  const { t } = useI18n();
  const back = useReturnTick();
  const [dates, setDates] = useDateRange('audit', 'month');
  const [typed, setF] = useState<Filters>(BLANK);
  const f = { ...typed, from: dates.from, to: dates.to };
  const [choices, setChoices] = useState<AuditFilterChoices>({ actions: [], entities: [], users: [] });
  const [data, setData] = useState<{ items: AuditView[]; total: number }>({ items: [], total: 0 });
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const load = (offset: number) =>
    call<{ items: AuditView[]; total: number }>('audit.list', { ...payload(f), offset, limit: PAGE }).then(
      (r) => setData((d) => ({ items: offset === 0 ? r.items : [...d.items, ...r.items], total: r.total })),
      (e: Error) => setMsg(t(e.message)),
    );
  useEffect(() => void call<AuditFilterChoices>('audit.filters').then(setChoices, () => undefined), [back]);
  useEffect(() => {
    const h = setTimeout(() => void load(0), f.text ? 250 : 0);
    return () => clearTimeout(h);
  }, [typed, dates.from, dates.to, back]);

  const exportCsv = async () => {
    try {
      const csv = await call<string>('audit.export', { ...payload(f), offset: 0, limit: 50_000 });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      a.download = 'audit-log.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMsg(t((e as Error).message));
    }
  };

  return (
    <div className="card section" style={{ maxWidth: 'none' }}>
      <DateNavigator name="Audit" value={dates} onChange={setDates} />
      <div className="row">
        <div><label>{t('Search')}</label><input data-kb-search="audit" aria-label="audit search" value={f.text} onChange={(e) => setF({ ...typed, text: e.target.value })} /></div>
        <div><label>{t('User')}</label>
          <select aria-label="audit user" value={f.userId} onChange={(e) => setF({ ...typed, userId: Number(e.target.value) })}>
            <option value={0}>{t('All')}</option>
            {choices.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div><label>{t('Action')}</label>
          <select aria-label="audit action" value={f.action} onChange={(e) => setF({ ...typed, action: e.target.value })}>
            <option value="">{t('All')}</option>
            {choices.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div><label>{t('Record type')}</label>
          <select aria-label="audit entity" value={f.entity} onChange={(e) => setF({ ...typed, entity: e.target.value })}>
            <option value="">{t('All')}</option>
            {choices.entities.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      {can('audit.export') && <p><button type="button" onClick={() => void exportCsv()}>{t('Export to CSV')}</button></p>}
      {msg && <p className="msg error">{msg}</p>}
      <p className="hint">{t('Showing {0} of {1}', data.items.length, data.total)}</p>
      <table className="list" aria-label="audit log">
        <thead><tr><th>{t('Time')}</th><th>{t('User')}</th><th>{t('Role')}</th><th>{t('Action')}</th><th>{t('Record')}</th><th>{t('Result')}</th></tr></thead>
        <tbody>
          {data.items.length === 0 && <EmptyRow cols={6} text={t('No records match.')} />}
          {data.items.map((r) => (
            <Row key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} openSale={openSale} openCustomer={openCustomer} />
          ))}
        </tbody>
      </table>
      {data.items.length < data.total && <p><button type="button" aria-label="show more audit" onClick={() => void load(data.items.length)}>{t('Show more')}</button></p>}
    </div>
  );
}

function Row({ r, open, toggle, openSale, openCustomer }: { r: AuditView; open: boolean; toggle: () => void; openSale: (invoiceNo: string) => void; openCustomer: (id: number) => void }) {
  const { t } = useI18n();
  const [item, setItem] = useState<ItemInfo | null>(null);
  const invoice = r.related?.type === 'sale' ? String(r.related.id) : null;
  const customer = r.entity === 'customer' && r.entityId ? Number(r.entityId) : null;
  const product = r.entity === 'product' && r.entityId ? Number(r.entityId) : null;
  return (
    <>
      <tr style={{ cursor: 'pointer' }} tabIndex={0} onClick={toggle} onKeyDown={(e) => e.key === 'Enter' && toggle()}>
        <td>{storeDateTime(r.at)}</td><td>{r.actor ?? t('System')}</td><td>{r.role}</td><td>{r.action}</td><td>{r.entity} {r.entityId}</td><td>{r.status === 'failed' ? t('Failed') : t('Done')}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <div className="row" aria-label="audit details">
              <div><strong>{t('Before')}</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.before === null ? t('Not recorded') : JSON.stringify(r.before, null, 1)}</pre></div>
              <div><strong>{t('After')}</strong><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.after === null ? t('Not recorded') : JSON.stringify(r.after, null, 1)}</pre></div>
            </div>
            {r.reason && <p><strong>{t('Reason')}:</strong> {r.reason}</p>}
            {r.screen && <p className="hint">{t('Screen')}: {r.screen}</p>}
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.details, null, 1)}</pre>
            {invoice && <button type="button" onClick={() => openSale(invoice)}>{t('Open sale {0}', invoice)}</button>}
            {customer !== null && <button type="button" onClick={() => openCustomer(customer)}>{t('Open customer')}</button>}
            {product !== null && <button type="button" onClick={() => void call<ItemInfo>('catalog.itemInfo', { productId: product }).then(setItem, () => setItem(null))}>{t('Item information')}</button>}
            {item && <p>{item.nameEn} · {formatSar(item.priceIncl)}</p>}
            {!invoice && r.related && <p className="hint">{r.related.type} {r.related.id}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
