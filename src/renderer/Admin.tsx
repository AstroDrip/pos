import { useEffect, useState } from 'react';
import type { BackupStatus } from '../services/backup';
import type { DryRun } from '../services/import';
import type { Supplier } from '../services/parties';
import { call } from './api';

type Msg = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

export function Admin({ can }: { can: (p: string) => boolean }) {
  return (
    <div className="page row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {can('backup.run') && <Backup canSetup={can('settings.manage')} canRestore={can('backup.restore')} />}
      {can('user.manage') && <Users />}
      {can('supplier.manage') && <Suppliers />}
      {(can('product.manage') || can('supplier.manage')) && <Import />}
    </div>
  );
}

export type FullBackupStatus = BackupStatus & { keyConfigured: boolean };

function Backup({ canSetup, canRestore }: { canSetup: boolean; canRestore: boolean }) {
  const [s, setS] = useState<FullBackupStatus | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<FullBackupStatus>('backup.status').then(setS);
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
    void load();
  };

  return (
    <div className="card" style={{ margin: 0 }}>
      <h3>Backup</h3>
      {s && (
        <>
          <p>Last verified local backup: <strong>{s.lastVerifiedLocal ? new Date(s.lastVerifiedLocal.at).toLocaleString() : 'never'}</strong></p>
          {s.lastFailure && <p className="msg error">Last failure {new Date(s.lastFailure.at).toLocaleString()}: {s.lastFailure.error}</p>}
          <p className="msg warn">Off-site (cloud) backup is not set up yet. Local backups are on this computer only: copy the backups folder to a USB drive regularly.</p>
          {!s.keyConfigured && canSetup && (
            <button className="primary" onClick={() => run(async () => setCode((await call<{ recoveryCode: string }>('backup.setupKey')).recoveryCode))}>
              Set up backup key
            </button>
          )}
          {!s.keyConfigured && !canSetup && <p>An administrator must set up the backup key.</p>}
          {s.keyConfigured && <button className="primary" onClick={() => run(async () => setMsg({ kind: 'ok', text: `Backup saved: ${(await call<{ fileName: string }>('backup.run')).fileName}` }))}>Back up now</button>}
        </>
      )}
      {code && (
        <div className="msg warn">
          <strong>Write this recovery code on paper and keep it somewhere safe, away from this computer.</strong> It is shown only once. Without it, backups cannot be restored on another computer.
          <pre style={{ fontSize: 18, whiteSpace: 'pre-wrap' }}>{code}</pre>
          <button onClick={() => setCode('')}>I have written it down</button>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      {canRestore && <Restore />}
    </div>
  );
}

/** Also shown on the first-run screen, so a replacement computer can be restored before any user exists. */
export function Restore() {
  const [code, setCode] = useState('');
  const [facts, setFacts] = useState<{ createdAt: string; lastInvoiceNo: string | null; counts: Record<string, number> } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const check = async () => {
    setMsg(null);
    try {
      setFacts(await call('restore.prepare', { recoveryCode: code.trim() || undefined }));
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };
  const apply = async () => {
    if (!window.confirm('Replace ALL current data with this backup? The current data is kept in a side file, not deleted. The app will restart.')) return;
    try {
      await call('restore.apply');
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div>
      <h4>Restore from backup</h4>
      <label>Recovery code (needed on a new computer)</label>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX-…" />
      <p><button onClick={check}>Choose backup file and check it</button></p>
      {facts && (
        <div className="msg ok">
          Backup from {new Date(facts.createdAt).toLocaleString()} is valid. Last invoice: {facts.lastInvoiceNo ?? 'none'}. Sales: {facts.counts.sales}, products: {facts.counts.products}.
          <p><button className="danger" onClick={apply}>Restore this backup</button></p>
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}

function Users() {
  const [list, setList] = useState<{ id: number; username: string; displayName: string; roles: string }[]>([]);
  const [f, setF] = useState({ username: '', displayName: '', pin: '', role: 'cashier' });
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<typeof list>('user.list').then(setList);
  useEffect(() => void load(), []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call('user.create', f);
      setF({ username: '', displayName: '', pin: '', role: 'cashier' });
      void load();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  };
  return (
    <form className="card" style={{ margin: 0 }} onSubmit={save}>
      <h3>Users</h3>
      <label>Username</label><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <label>Display name</label><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      <label>PIN (4–8 digits)</label><input type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
      <label>Role</label>
      <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
        <option value="cashier">Cashier</option><option value="supervisor">Supervisor</option><option value="admin">Administrator</option>
      </select>
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary">Add user</button></p>
      <table className="list"><tbody>{list.map((u) => <tr key={u.id}><td>{u.username}</td><td>{u.displayName}</td><td>{u.roles}</td></tr>)}</tbody></table>
    </form>
  );
}

function Suppliers() {
  const [list, setList] = useState<Supplier[]>([]);
  const [f, setF] = useState({ name: '', phone: '', vatNumber: '', terms: '0' });
  const [msg, setMsg] = useState<Msg>(null);
  const load = () => call<Supplier[]>('supplier.list').then(setList);
  useEffect(() => void load(), []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call('supplier.create', { name: f.name, phone: f.phone || undefined, vatNumber: f.vatNumber || undefined, paymentTermsDays: Number.parseInt(f.terms || '0', 10) });
      setF({ name: '', phone: '', vatNumber: '', terms: '0' });
      void load();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <form className="card" style={{ margin: 0 }} onSubmit={save}>
      <h3>Suppliers</h3>
      <label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>Phone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <label>VAT number</label><input value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value })} />
      <label>Payment terms (days)</label><input value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
      <p><button className="primary">Add supplier</button></p>
      <table className="list"><tbody>{list.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.phone}</td><td>{s.paymentTermsDays}d</td></tr>)}</tbody></table>
    </form>
  );
}

function Import() {
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
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };
  const commit = async () => {
    try {
      const n = await call<number>('import.commit', { kind, csv, acceptWarnings: accept });
      setMsg({ kind: 'ok', text: `Imported ${n} ${kind}.` });
      setDry(null);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="card" style={{ margin: 0 }}>
      <h3>Import from CSV</h3>
      <select value={kind} onChange={(e) => { setKind(e.target.value as 'products' | 'suppliers'); setDry(null); }}>
        <option value="products">Products</option>
        <option value="suppliers">Suppliers</option>
      </select>
      <p className="ar" style={{ direction: 'ltr' }}>
        {kind === 'products' ? 'Columns: sku, name_ar, name_en, sold_by (piece|kg), price_incl, vat_percent, barcode, plu' : 'Columns: name, phone, vat_number, payment_terms_days'}
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
      <p><button disabled={!csv} onClick={check}>Check file (nothing is saved)</button></p>
      {dry && (
        <div>
          <p>{dry.rows} rows: {dry.valid.length} ready, {dry.issues.length} problems, {dry.warnings.length} warnings.</p>
          {[...dry.issues.map((i) => ({ ...i, kind: 'error' })), ...dry.warnings.map((i) => ({ ...i, kind: 'warn' }))].slice(0, 200).map((i, k) => (
            <div key={k} className={`msg ${i.kind}`}>Row {i.row}, {i.field}: {i.message}</div>
          ))}
          {dry.issues.length === 0 && (
            <>
              {dry.warnings.length > 0 && <label><input type="checkbox" style={{ width: 'auto' }} checked={accept} onChange={(e) => setAccept(e.target.checked)} /> I have checked the warnings</label>}
              <p><button className="primary" disabled={dry.warnings.length > 0 && !accept} onClick={commit}>Import {dry.valid.length} rows</button></p>
            </>
          )}
        </div>
      )}
      {msg && <p className={`msg ${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
