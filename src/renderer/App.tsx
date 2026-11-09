import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '../services/users';
import { Admin, Restore, type FullBackupStatus } from './Admin';
import { call } from './api';
import { LangToggle, useI18n } from './i18n';
import { Accounting } from './Accounting';
import { Expenses } from './Expenses';
import { Help } from './Help';
import { HelpContext } from './help/HelpContext';
import { KeyboardProvider, focusEl } from './Keyboard';
import { TabPane, UserProvider } from './TabHost';
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
  const [error, setError] = useState('');
  const refresh = () => call<Status>('auth.status').then(setStatus, (e: Error) => setError(t(e.message)));
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

  return (
    <UserProvider value={status.user}>
      <Workspace key={status.user.id} user={status.user} onAuthChange={() => void refresh()} />
    </UserProvider>
  );
}

/** Everything a logged-in user sees. Keyed by user: logging out or changing cashier destroys all of it. */
function Workspace({ user, onAuthChange }: { user: User; onAuthChange: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('sell');
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(['sell']));
  const show = useCallback((screen: Tab) => {
    setVisited((v) => (v.has(screen) ? v : new Set(v).add(screen)));
    setTab(screen);
  }, []);
  // A "?" link opens help OVER the current screen, so a bill or a half-filled form is never lost.
  const [helpAt, setHelpAt] = useState<string | null>(null);
  const helpReturn = useRef<HTMLElement | null>(null);
  const openHelp = useCallback((id: string) => {
    helpReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHelpAt(id);
  }, []);
  const closeHelp = useCallback(() => {
    setHelpAt(null);
    const el = helpReturn.current;
    helpReturn.current = null;
    requestAnimationFrame(() => focusEl(el)); // back to the box the cashier was in
  }, []);
  const [customerRequest, setCustomerRequest] = useState<{ id?: number; n: number }>({ n: 0 });
  const openCustomers = useCallback((id?: number) => {
    setCustomerRequest((r) => ({ id, n: r.n + 1 }));
    show('customers');
  }, [show]);
  const openTab = useCallback((screen: Tab) => {
    setCustomerRequest({ n: 0 });
    show(screen);
  }, [show]);
  const can = (p: string) => user.permissions.includes(p);
  const pane = (id: Tab, node: React.ReactNode) => {
    const perm = TABS.find((x) => x.id === id)?.perm;
    return visited.has(id) && (!perm || can(perm)) && <TabPane id={id} active={tab === id}>{node}</TabPane>;
  };
  return (
    <HelpContext.Provider value={openHelp}>
      <KeyboardProvider tab={tab} openTab={openTab} can={can} helpOpen={helpAt !== null} openHelp={openHelp} closeHelp={closeHelp} openCustomers={openCustomers}>
      <TopBar>
        <strong className="brand">POS</strong>
        <nav aria-label="main">
          {TABS.filter((tb) => !tb.perm || can(tb.perm)).map((tb, i, shown) => (
            <span key={tb.id} style={{ display: 'contents' }}>
              {i > 0 && shown[i - 1]!.group !== tb.group && <span className="sep" aria-hidden="true" />}
              <button className={tab === tb.id ? 'active' : ''} aria-current={tab === tb.id ? 'page' : undefined} onClick={() => openTab(tb.id)}>{tb.id === 'help' && <span className="help-mark" aria-hidden="true">?</span>}{t(tb.label)}</button>
            </span>
          ))}
        </nav>
        <div className="utils">
          <BackupBadge />
          <ThemeSelect />
          <LangToggle />
          <span className="who" title={user.displayName}>{user.displayName}</span>
          <button onClick={() => void call('auth.logout').then(onAuthChange)}>{t('Log out')}</button>
        </div>
      </TopBar>
      {can('reports.view') && <HealthBanner />}
      {pane('sell', <Sell canDiscount={can('sale.discount')} canCredit={can('customer.credit.sell')} canCreateCustomer={can('customer.manage')} />)}
      {pane('refund', <Refund canApprove={can('sale.refund')} />)}
      {pane('stock', <Stock can={can} />)}
      {pane('products', <Products />)}
      {pane('reports', <Reports />)}
      {pane('customers', <Customers can={can} request={customerRequest} />)}
      {pane('purchases', <Purchases can={can} />)}
      {pane('expenses', <Expenses can={can} />)}
      {pane('accounting', <Accounting />)}
      {pane('shift', <Shift can={can} />)}
      {pane('admin', <Admin can={can} />)}
      {pane('help', <Help />)}
      {helpAt && <HelpOverlay article={helpAt} onClose={closeHelp} />}
      </KeyboardProvider>
    </HelpContext.Provider>
  );
}

/** Help shown over the current screen (F1 or a "?" link). Esc (central key handler) or Close returns to exactly where the user was. */
function HelpOverlay({ article, onClose }: { article: string; onClose: () => void }) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label={t('Help')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help-overlay-panel">
        <button ref={closeRef} type="button" className="close" onClick={onClose}>{t('Close')}</button>
        <Help initial={article} />
      </div>
    </div>
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
