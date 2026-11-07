import { useEffect, useRef, useState } from 'react';
import type { User } from '../services/users';
import { Admin, Restore, type FullBackupStatus } from './Admin';
import { call } from './api';
import { LangToggle, useI18n } from './i18n';
import { Accounting } from './Accounting';
import { Expenses } from './Expenses';
import { Help } from './Help';
import { HelpContext } from './help/HelpContext';
import { Customers } from './Customers';
import { Products } from './Products';
import { Purchases } from './Purchases';
import { Refund } from './Refund';
import { Reports } from './Reports';
import { Sell } from './Sell';
import { Shift } from './Shift';
import { Stock } from './Stock';
import { ThemeSelect } from './theme';

type Status = { needsSetup: boolean; user: User | null };
type Tab = 'sell' | 'refund' | 'customers' | 'purchases' | 'expenses' | 'accounting' | 'stock' | 'products' | 'reports' | 'shift' | 'admin' | 'help';

// Grouped by workflow: till · goods · money · day and settings. A thin separator is drawn between groups.
const TABS: { id: Tab; label: string; perm?: string; group: number }[] = [
  { id: 'sell', label: 'Sell', group: 1 },
  { id: 'refund', label: 'Refund', group: 1 },
  { id: 'customers', label: 'Customers', perm: 'customer.payment.record', group: 1 },
  { id: 'stock', label: 'Stock', perm: 'stock.receive', group: 2 },
  { id: 'products', label: 'Products', perm: 'product.manage', group: 2 },
  { id: 'purchases', label: 'Purchases', perm: 'purchase.view', group: 2 },
  { id: 'expenses', label: 'Expenses', perm: 'expense.view', group: 3 },
  { id: 'accounting', label: 'Accounting', perm: 'finance.view', group: 3 },
  { id: 'reports', label: 'Reports', perm: 'reports.view', group: 3 },
  { id: 'shift', label: 'Shift', group: 4 },
  { id: 'admin', label: 'Admin', perm: 'backup.run', group: 4 },
  { id: 'help', label: 'Help', group: 4 }, // every role
];

export function App() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<Tab>('sell');
  const [error, setError] = useState('');
  const [helpAt, setHelpAt] = useState<string | undefined>(undefined);
  const openHelp = (id: string) => {
    setHelpAt(id);
    setTab('help');
  };

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
  if (!status.user) {
    return (
      <>
        <div className="top"><strong className="brand">POS</strong><span className="spacer" /><div className="utils"><ThemeSelect /><LangToggle /></div></div>
        <Login onDone={refresh} />
      </>
    );
  }

  const user = status.user;
  const can = (p: string) => user.permissions.includes(p);
  return (
    <HelpContext.Provider value={openHelp}>
      <TopBar>
        <strong className="brand">POS</strong>
        <nav aria-label="main">
          {TABS.filter((tb) => !tb.perm || can(tb.perm)).map((tb, i, shown) => (
            <span key={tb.id} style={{ display: 'contents' }}>
              {i > 0 && shown[i - 1]!.group !== tb.group && <span className="sep" aria-hidden="true" />}
              <button className={tab === tb.id ? 'active' : ''} aria-current={tab === tb.id ? 'page' : undefined} onClick={() => { if (tb.id === 'help') setHelpAt(undefined); setTab(tb.id); }}>{tb.id === 'help' && <span className="help-mark" aria-hidden="true">?</span>}{t(tb.label)}</button>
            </span>
          ))}
        </nav>
        <div className="utils">
          <BackupBadge />
          <ThemeSelect />
          <LangToggle />
          <span className="who" title={user.displayName}>{user.displayName}</span>
          <button onClick={() => call('auth.logout').then(refresh)}>{t('Log out')}</button>
        </div>
      </TopBar>
      {can('reports.view') && <HealthBanner />}
      {tab === 'sell' && <Sell canDiscount={can('sale.discount')} canCredit={can('customer.credit.sell')} />}
      {tab === 'refund' && <Refund canApprove={can('sale.refund')} />}
      {tab === 'stock' && <Stock can={can} />}
      {tab === 'products' && <Products />}
      {tab === 'reports' && <Reports />}
      {tab === 'customers' && <Customers can={can} />}
      {tab === 'purchases' && <Purchases can={can} />}
      {tab === 'expenses' && <Expenses can={can} />}
      {tab === 'accounting' && <Accounting />}
      {tab === 'shift' && <Shift can={can} />}
      {tab === 'admin' && <Admin can={can} />}
      {tab === 'help' && <Help initial={helpAt} />}
    </HelpContext.Provider>
  );
}

/** The top bar. Its height changes when the tabs wrap; --topbar-h follows it so full-height screens (Sell) still fit. */
function TopBar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--topbar-h');
    };
  }, []);
  return <div className="top" ref={ref}>{children}</div>;
}

/** Shows a red warning if the audit log has been tampered with (hash chain broken). */
function HealthBanner() {
  const { t } = useI18n();
  const [h, setH] = useState<{ auditChainOk: boolean; firstBrokenAuditId: number | null } | null>(null);
  useEffect(() => void call<typeof h>('system.health').then(setH, () => setH(null)), []);
  if (!h || h.auditChainOk) return null;
  return <div className="msg error" style={{ margin: 'var(--sp-2) var(--sp-4) 0' }}>{t('WARNING: the audit log has been altered outside the app (first bad record #{0}). Keep a copy of the database and contact support.', h.firstBrokenAuditId ?? '?')}</div>;
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
  const cls = s.lastFailure || !last ? 'badge-bad' : ageH > 24 ? 'badge-warn' : 'badge-ok';
  const text = !s.keyConfigured ? t('Backup not set up') : last ? (ageH < 1 ? t('Backup less than 1h ago (local only)') : t('Backup {0}h ago (local only)', Math.floor(ageH))) : t('No backup yet');
  return <span className={`backup ${cls}`} title={s.lastFailure?.error ?? text}><span className="dot" aria-hidden="true" />{text}</span>;
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
