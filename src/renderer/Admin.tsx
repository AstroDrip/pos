import { useEffect, useState } from 'react';
import { CloudBackup } from './CloudBackup';
import { HardwareTest } from './HardwareTest';
import type { BackupStatus } from '../services/backup';
import type { DryRun } from '../services/import';
import type { LookupResult, ScaleLayoutRow } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { SyncHealth } from '../services/dashboard-sync';
import { formatQty } from '../core/money';
import { call } from './api';
import { InfoIcon } from './InfoIcon';
import { useReturnTick } from './TabHost';
import { PageHeader } from './PageHeader';
import { useI18n } from './i18n';
import { KeyboardSettings } from './KeyboardSettings';
import { StoreDetailsCard } from './StoreDetailsCard';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

export function Admin({ can }: { can: (p: string) => boolean }) {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader title={t('Admin')} desc={t('Backups, users, suppliers, imports and device settings.')} />
      <div className="grid-cards">
      {can('backup.run') && <Backup canSetup={can('settings.manage')} canRestore={can('backup.restore')} />}
      {can('backup.run') && <CloudBackup can={can} />}
      {can('settings.manage') && <HardwareTest />}
      {can('user.manage') && <Users />}
      {can('supplier.manage') && <Suppliers />}
      {(can('product.manage') || can('supplier.manage')) && <Import />}
      {can('settings.manage') && <ScaleLabels />}
      {can('settings.manage') && <DashboardHealth />}
      {can('settings.manage') && <StoreDetailsCard />}
      {can('settings.manage') && <KeyboardSettings />}
      </div>
    </div>
  );
}

export type FullBackupStatus = BackupStatus & { keyConfigured: boolean };

function Backup({ canSetup, canRestore }: { canSetup: boolean; canRestore: boolean }) {
  const back = useReturnTick();
  const { t } = useI18n();
  const [s, setS] = useState<FullBackupStatus | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<FullBackupStatus>('backup.status').then(setS);
  useEffect(() => void load(), [back]);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
    void load();
  };

  return (
    <div className="card">
      <h3>{t('Backup')}</h3>
      {s && (
        <>
          <p>{t('Last verified local backup:')} <strong>{s.lastVerifiedLocal ? new Date(s.lastVerifiedLocal.at).toLocaleString() : t('never')}</strong></p>
          {s.lastFailure && <p className="msg error">{t('Last failure {0}: {1}', new Date(s.lastFailure.at).toLocaleString(), s.lastFailure.error)}</p>}
          <p className="msg warn">{t('Off-site (cloud) backup is not set up yet. Local backups are on this computer only: copy the backups folder to a USB drive regularly.')}</p>
          {!s.keyConfigured && canSetup && (
            <button className="primary" onClick={() => run(async () => setCode((await call<{ recoveryCode: string }>('backup.setupKey')).recoveryCode))}>
              {t('Set up backup key')}
            </button>
          )}
          {!s.keyConfigured && !canSetup && <p>{t('An administrator must set up the backup key.')}</p>}
          {s.keyConfigured && <button className="primary" onClick={() => run(async () => setMsg({ kind: 'ok', text: t('Backup saved: {0}', (await call<{ fileName: string }>('backup.run')).fileName) }))}>{t('Back up now')}</button>}
        </>
      )}
      {code && (
        <div className="msg warn">
          <strong>{t('Write this recovery code on paper and keep it somewhere safe, away from this computer.')}</strong> {t('It is shown only once. Without it, backups cannot be restored on another computer.')}
          <pre style={{ fontSize: 18, whiteSpace: 'pre-wrap' }}>{code}</pre>
          <button onClick={() => setCode('')}>{t('I have written it down')}</button>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {canRestore && <Restore />}
    </div>
  );
}

/** Also shown on the first-run screen, so a replacement computer can be restored before any user exists. */
export function Restore() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [facts, setFacts] = useState<{ createdAt: string; lastInvoiceNo: string | null; counts: Record<string, number>; newerLocal?: boolean } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const check = async () => {
    setMsg(null);
    try {
      setFacts(await call('restore.prepare', { recoveryCode: code.trim() || undefined }));
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  const apply = async () => {
    if (facts?.newerLocal && !window.confirm(t('This computer has sales that are not in this backup. They will leave the live data. Continue?'))) return;
    if (!window.confirm(t('Replace ALL current data with this backup? The current data is kept in a side file, not deleted. The app will restart.'))) return;
    try {
      await call('restore.apply', { acknowledgeOlder: true });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  return (
    <div>
      <h4>{t('Restore from backup')}</h4>
      <label>{t('Recovery code (needed on a new computer)')}</label>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX-…" />
      <p><button onClick={check}>{t('Choose backup file and check it')}</button></p>
      {facts && (
        <div className="msg ok">
          {t('Backup from {0} is valid. Last invoice: {1}. Sales: {2}, products: {3}.', new Date(facts.createdAt).toLocaleString(), facts.lastInvoiceNo ?? t('none'), facts.counts.sales ?? 0, facts.counts.products ?? 0)}
          <p><button className="danger" onClick={apply}>{t('Restore this backup')}</button></p>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

function Users() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [list, setList] = useState<{ id: number; username: string; displayName: string; roles: string; active: boolean }[]>([]);
  const [f, setF] = useState({ username: '', displayName: '', pin: '', role: 'cashier' });
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<typeof list>('user.list').then(setList);
  useEffect(() => void load(), [back]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call('user.create', f);
      setF({ username: '', displayName: '', pin: '', role: 'cashier' });
      void load();
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };
  return (
    <form className="card" onSubmit={save}>
      <h3>{t('Users')}</h3>
      <label>{t('Username')} <InfoIcon id="field.user.username" /></label><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <label>{t('Display name')} <InfoIcon id="field.user.displayName" /></label><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      <label>{t('PIN (4–8 digits)')}</label><input type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
      <label>{t('Role')} <InfoIcon id="field.user.role" /></label>
      <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
        <option value="cashier">{t('Cashier')}</option><option value="supervisor">{t('Supervisor')}</option><option value="admin">{t('Administrator')}</option>
      </select>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary">{t('Add user')}</button></p>
      <table className="list"><tbody>{list.map((u) => (
        <tr key={u.id} style={u.active ? undefined : { color: 'var(--muted)', textDecoration: 'line-through' }}>
          <td>{u.username}</td><td>{u.displayName}</td><td>{u.roles}</td>
          <td><button type="button" onClick={() => call('user.setActive', { userId: u.id, active: !u.active }).then(load, (e: Error) => setMsg({ kind: 'error', text: t(e.message) }))}>{u.active ? t('Deactivate') : t('Reactivate')}</button></td>
        </tr>
      ))}</tbody></table>
    </form>
  );
}

function Suppliers() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [list, setList] = useState<Supplier[]>([]);
  const blank = { name: '', phone: '', vatNumber: '', terms: '0', address: '', crNumber: '', ourCustomerNo: '', salesman: '' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<Supplier[]>('supplier.list').then(setList);
  useEffect(() => void load(), [back]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const fields = { name: f.name, phone: f.phone || undefined, vatNumber: f.vatNumber || undefined, paymentTermsDays: Number.parseInt(f.terms || '0', 10), address: f.address || undefined, crNumber: f.crNumber || undefined, ourCustomerNo: f.ourCustomerNo || undefined, salesman: f.salesman || undefined };
      if (editing) await call('supplier.update', { id: editing, ...fields });
      else await call('supplier.create', fields);
      setF(blank);
      setEditing(null);
      void load();
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    }
  };

  return (
    <form className="card" onSubmit={save}>
      <h3>{t('Suppliers')}</h3>
      <label>{t('Name')} <InfoIcon id="field.supplier.name" /></label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>{t('Phone')} <InfoIcon id="field.supplier.phone" /></label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <label>{t('VAT number')} <InfoIcon id="field.supplier.vat" /></label><input value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value })} />
      <label>{t('Payment terms (days)')} <InfoIcon id="field.supplier.terms" /></label><input value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
      <label>{t('Address')} <InfoIcon id="field.supplier.address" /></label><input aria-label="supplier address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <label>{t('CR number')} <InfoIcon id="field.supplier.cr" /></label><input aria-label="supplier cr" value={f.crNumber} onChange={(e) => setF({ ...f, crNumber: e.target.value })} />
      <label>{t('Our customer number at this supplier')} <InfoIcon id="field.supplier.ourNo" /></label><input aria-label="our customer number" value={f.ourCustomerNo} onChange={(e) => setF({ ...f, ourCustomerNo: e.target.value })} />
      <label>{t('Salesman')} <InfoIcon id="field.supplier.salesman" /></label><input aria-label="supplier salesman" value={f.salesman} onChange={(e) => setF({ ...f, salesman: e.target.value })} />
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p className="row">
        <button className="primary">{editing ? t('Save supplier') : t('Add supplier')}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setF(blank); setMsg(null); }}>{t('Cancel')}</button>}
      </p>
      <table className="list"><tbody>{list.map((s) => (
        <tr key={s.id}>
          <td>{s.name}</td><td>{s.phone}</td><td>{s.paymentTermsDays}d</td>
          <td className="num"><button type="button" aria-label={`edit supplier ${s.name}`} onClick={() => {
            setEditing(s.id);
            setMsg(null);
            setF({ name: s.name, phone: s.phone ?? '', vatNumber: s.vatNumber ?? '', terms: String(s.paymentTermsDays), address: s.address ?? '', crNumber: s.crNumber ?? '', ourCustomerNo: s.ourCustomerNo ?? '', salesman: s.salesman ?? '' });
          }}>{t('Edit')}</button></td>
        </tr>
      ))}</tbody></table>
    </form>
  );
}

function Import() {
  const { t } = useI18n();
  const [kind, setKind] = useState<'products' | 'suppliers'>('products');
  const [csv, setCsv] = useState('');
  const [dry, setDry] = useState<DryRun<unknown> | null>(null);
  const [accept, setAccept] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const readFile = (file: File | undefined) => {
    setDry(null);
    setMsg(null);
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result));
    r.readAsText(file, 'utf-8');
  };
  const check = async () => {
    setMsg(null);
    try {
      setDry(await call<DryRun<unknown>>('import.dryRun', { kind, csv }));
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  const commit = async () => {
    try {
      const n = await call<number>('import.commit', { kind, csv, acceptWarnings: accept });
      setMsg({ kind: 'ok', text: t('Imported {0} {1}.', n, t(kind === 'products' ? 'Products' : 'Suppliers')) });
      setDry(null);
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  return (
    <div className="card">
      <h3>{t('Import from CSV')}</h3>
      <select value={kind} onChange={(e) => { setKind(e.target.value as 'products' | 'suppliers'); setDry(null); }}>
        <option value="products">{t('Products')}</option>
        <option value="suppliers">{t('Suppliers')}</option>
      </select>
      <p className="ar" style={{ direction: 'ltr' }}>
        {kind === 'products' ? 'Columns: sku, name_ar, name_en, sold_by (piece|kg), price_incl, vat_percent, barcode, plu' : 'Columns: name, phone, vat_number, payment_terms_days'}
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
      <p><button disabled={!csv} onClick={check}>{t('Check file (nothing is saved)')}</button></p>
      {dry && (
        <div>
          <p>{t('{0} rows: {1} ready, {2} problems, {3} warnings.', dry.rows, dry.valid.length, dry.issues.length, dry.warnings.length)}</p>
          {[...dry.issues.map((i) => ({ ...i, kind: 'error' })), ...dry.warnings.map((i) => ({ ...i, kind: 'warn' }))].slice(0, 200).map((i, k) => (
            <div key={k} className={`msg ${i.kind}`}>{t('Row {0}, {1}: {2}', i.row, i.field, i.message)}</div>
          ))}
          {dry.issues.length === 0 && (
            <>
              {dry.warnings.length > 0 && <label><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> {t('I have checked the warnings')}</label>}
              <p><button className="primary" disabled={dry.warnings.length > 0 && !accept} onClick={commit}>{t('Import {0} rows', dry.valid.length)}</button></p>
            </>
          )}
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

/**
 * Scale label layouts (ADR-3). The store's real layout must be copied from a real label: scan one into
 * "Test a label" and adjust the layout until the product and weight are right.
 */
function ScaleLabels() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [rows, setRows] = useState<ScaleLayoutRow[]>([]);
  const [f, setF] = useState({ id: 0, name: '', spec: 'lit=2 item:4 weight_g:5 plu:3', itemMatches: 'plu' as 'plu' | 'sku', active: true });
  const [test, setTest] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<ScaleLayoutRow[]>('scale.layouts').then(setRows, () => setRows([]));
  useEffect(() => void load(), [back]);

  const save = async () => {
    setMsg(null);
    try {
      await call('scale.saveLayout', { id: f.id || undefined, name: f.name, spec: f.spec, itemMatches: f.itemMatches, active: f.active });
      setMsg({ kind: 'ok', text: t('Layout saved') });
      setF({ ...f, id: 0, name: '' });
      void load();
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };
  const tryLabel = async () => {
    setMsg(null);
    try {
      const r = await call<LookupResult | null>('catalog.lookup', { code: test.trim() });
      if (!r) setMsg({ kind: 'warn', text: t('Not a scale label for any active layout, and no product has this code.') });
      else setMsg({ kind: r.source === 'scale' ? 'ok' : 'warn', text: `${r.source}: ${r.product.nameEn} · ${formatQty(r.qty, r.product.sellMode === 'unit' ? 0 : 3)} ${r.product.sellMode === 'weight' ? 'kg' : ''}` });
    } catch (e) {
      setMsg({ kind: 'error', text: t((e as Error).message) });
    }
  };

  return (
    <div className="card section">
      <h3>{t('Scale labels')}</h3>
      <p className="msg warn">{t('The real label layout is not confirmed yet. Scan a real label below and check product and weight before using it.')}</p>
      <table className="list">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td><td><code>{r.spec}</code></td><td>{r.active ? t('Active') : t('Off')}</td>
              <td><button onClick={() => setF({ id: r.id, name: r.name, spec: r.spec, itemMatches: r.itemMatches, active: r.active })}>{t('Edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>{t('Layout name')} <InfoIcon id="field.scale.name" /></label>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>{t('Fields in label order')} <InfoIcon id="field.scale.fields" /></label>
      <input aria-label="layout spec" value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} />
      <small className="ar" style={{ direction: 'ltr' }}>lit=21 · item:5 · plu:4 · weight_g:5 · weight_kg3:5 · price:5 · pieces:2 · skip:1 · check</small>
      <label>{t('Item code is looked up as')} <InfoIcon id="field.scale.lookup" /></label>
      <select value={f.itemMatches} onChange={(e) => setF({ ...f, itemMatches: e.target.value as 'plu' | 'sku' })}>
        <option value="plu">PLU</option>
        <option value="sku">SKU</option>
      </select>
      <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('Active')} <InfoIcon id="field.active" /></label>
      <p><button className="primary" disabled={!f.name.trim()} onClick={save}>{f.id ? t('Update layout') : t('Add layout')}</button></p>
      <label>{t('Test a label (scan or type it)')}</label>
      <div className="row">
        <input aria-label="test label" value={test} onChange={(e) => setTest(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void tryLabel()} />
        <button disabled={!test.trim()} onClick={tryLabel}>{t('Test')}</button>
      </div>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

/** Owner phone dashboard: sync status only. The remote service is not set up yet (owner decision). */
function DashboardHealth() {
  const back = useReturnTick();
  const { t } = useI18n();
  const [h, setH] = useState<SyncHealth | null>(null);
  useEffect(() => void call<SyncHealth>('dashboard.health').then(setH, () => setH(null)), [back]);
  if (!h) return null;
  return (
    <div className="card section">
      <h3>{t('Owner phone dashboard')}</h3>
      {!h.enabled ? (
        <p className="msg warn">{t('Not set up. It needs an online dashboard service; choose a provider first. Nothing is sent anywhere until then.')}</p>
      ) : (
        <table className="list"><tbody>
          <tr><td>{t('Last successful sync')}</td><td>{h.lastSuccessAt ? new Date(h.lastSuccessAt).toLocaleString() : t('Never')}</td></tr>
          <tr><td>{t('Waiting to send')}</td><td>{h.pending}</td></tr>
          <tr><td>{t('Phone figures')}</td><td className={h.stale ? 'badge-bad' : 'badge-ok'}>{h.stale ? t('may be out of date') : t('up to date')}</td></tr>
          {h.lastError && <tr><td>{t('Last error')}</td><td>{h.lastError}</td></tr>}
        </tbody></table>
      )}
    </div>
  );
}
