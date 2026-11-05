import { useEffect, useState } from 'react';
import type { User } from '../services/users';
import { Admin, Restore, type FullBackupStatus } from './Admin';
import { call } from './api';
import { LangToggle, useI18n } from './i18n';
import { Products } from './Products';
import { Reports } from './Reports';
import { Sell } from './Sell';
import { Shift } from './Shift';
import { Stock } from './Stock';

type Status = { needsSetup: boolean; user: User | null };
type Tab = 'sell' | 'stock' | 'products' | 'reports' | 'shift' | 'admin';

const TABS: { id: Tab; label: string; perm?: string }[] = [
  { id: 'sell', label: 'Sell' },
  { id: 'stock', label: 'Stock', perm: 'stock.receive' },
  { id: 'products', label: 'Products', perm: 'product.manage' },
  { id: 'reports', label: 'Reports', perm: 'reports.view' },
  { id: 'shift', label: 'Shift' },
  { id: 'admin', label: 'Admin', perm: 'backup.run' },
];

export function App() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<Tab>('sell');
  const [error, setError] = useState('');

  // Every login starts on Sell: the previous user's tab may be one the new user is not allowed to see.
  const refresh = () =>
    call<Status>('auth.status').then((s) => {
      setTab('sell');
      setStatus(s);
    }, (e: Error) => setError(t(e.message)));
  useEffect(() => void refresh(), []);

  if (error) return <div className="card msg error">{error}</div>;
  if (!status) return null;
  if (status.needsSetup) {
    return (
      <>
        <Login setup onDone={refresh} />
        <div className="card">
          <p>{t("Replacing a computer? Restore the store's data instead of starting fresh.")}</p>
          <Restore />
        </div>
      </>
    );
  }
  if (!status.user) return <Login onDone={refresh} />;

  const user = status.user;
  const can = (p: string) => user.permissions.includes(p);
  return (
    <>
      <div className="top">
        <strong>POS</strong>
        {TABS.filter((tb) => !tb.perm || can(tb.perm)).map((tb) => (
          <button key={tb.id} className={tab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>{t(tb.label)}</button>
        ))}
        <span className="spacer" />
        <BackupBadge />
        <LangToggle />
        <span>{user.displayName}</span>
        <button onClick={() => call('auth.logout').then(refresh)}>{t('Log out')}</button>
      </div>
      {can('reports.view') && <HealthBanner />}
      {tab === 'sell' && <Sell canDiscount={can('sale.discount')} />}
      {tab === 'stock' && <Stock can={can} />}
      {tab === 'products' && <Products />}
      {tab === 'reports' && <Reports />}
      {tab === 'shift' && <Shift can={can} />}
      {tab === 'admin' && <Admin can={can} />}
    </>
  );
}

/** Shows a red warning if the audit log has been tampered with (hash chain broken). */
function HealthBanner() {
  const { t } = useI18n();
  const [h, setH] = useState<{ auditChainOk: boolean; firstBrokenAuditId: number | null } | null>(null);
  useEffect(() => void call<typeof h>('system.health').then(setH, () => setH(null)), []);
  if (!h || h.auditChainOk) return null;
  return <div className="msg error" style={{ margin: 8 }}>{t('WARNING: the audit log has been altered outside the app (first bad record #{0}). Keep a copy of the database and contact support.', h.firstBrokenAuditId ?? '?')}</div>;
}

/** Always-visible backup state (plan §J): green under 24 h, amber older, red never/failed. */
function BackupBadge() {
  const { t } = useI18n();
  const [s, setS] = useState<FullBackupStatus | null>(null);
  useEffect(() => {
    const load = () => void call<FullBackupStatus>('backup.status').then(setS, () => setS(null));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;
  const last = s.lastVerifiedLocal;
  const ageH = last ? (Date.now() - Date.parse(last.at)) / 3_600_000 : Infinity;
  const color = s.lastFailure || !last ? '#f97066' : ageH > 24 ? '#fdb022' : '#32d583';
  const text = !s.keyConfigured ? t('Backup not set up') : last ? (ageH < 1 ? t('Backup less than 1h ago (local only)') : t('Backup {0}h ago (local only)', Math.floor(ageH))) : t('No backup yet');
  return <span style={{ color, marginRight: 12 }} title={s.lastFailure?.error}>● {text}</span>;
}

function Login({ setup = false, onDone }: { setup?: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (setup) await call('auth.setupAdmin', { username, displayName, pin });
      else await call('auth.login', { username, pin });
      onDone();
    } catch (err) {
      setError(t((err as Error).message));
      setPin('');
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{setup ? t('First-time setup: create the owner account') : t('Log in')}</h2>
      <label>{t('Username')}</label>
      <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
      {setup && (
        <>
          <label>{t('Display name')}</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </>
      )}
      <label>{t('PIN (4–8 digits)')}</label>
      <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      {error && <p className="msg error">{error}</p>}
      <p>
        <button className="primary" type="submit">{setup ? t('Create owner') : t('Log in')}</button>
      </p>
    </form>
  );
}
