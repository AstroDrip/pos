import { useCallback, useEffect, useRef, useState } from 'react';
import { NavIcon } from './NavIcons';
import type { User } from '../services/users';
import { Admin, Restore, type FullBackupStatus } from './Admin';
import { CloudRestoreNewComputer } from './CloudBackup';
import { call } from './api';
import { LangToggle, useI18n } from './i18n';
import { Accounting } from './Accounting';
import { Audit } from './Audit';
import { BooksCheck } from './BooksCheck';
import { Expenses } from './Expenses';
import { Help } from './Help';
import { HelpContext } from './help/HelpContext';
import { KeyboardProvider, focusEl } from './Keyboard';
import { validBool, validOneOf } from './remember';
import { TabPane, UserProvider, useRemembered } from './TabHost';
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
type Tab = 'sell' | 'refund' | 'customers' | 'purchases' | 'expenses' | 'accounting' | 'stock' | 'products' | 'reports' | 'shift' | 'admin' | 'audit' | 'help';

// The one list of screens, in sidebar order. Each screen belongs to a group; a role sees only what it may open.
const TABS: { id: Tab; label: string; perm?: string; group: string }[] = [
  { id: 'sell', label: 'Sell', group: 'Sales' },
  { id: 'refund', label: 'Refund', group: 'Sales' },
  { id: 'customers', label: 'Customers', perm: 'customer.payment.record', group: 'Sales' },
  { id: 'shift', label: 'Shift', group: 'Sales' },
  { id: 'products', label: 'Products', perm: 'product.manage', group: 'Inventory' },
  { id: 'stock', label: 'Stock', perm: 'stock.receive', group: 'Inventory' },
  { id: 'purchases', label: 'Purchases', perm: 'purchase.view', group: 'Purchasing' },
  { id: 'expenses', label: 'Expenses', perm: 'expense.view', group: 'Finance' },
  { id: 'accounting', label: 'Accounting', perm: 'finance.view', group: 'Finance' },
  { id: 'reports', label: 'Reports', perm: 'reports.view', group: 'Insights' },
  { id: 'audit', label: 'Audit', perm: 'audit.view', group: 'Insights' },
  { id: 'admin', label: 'Admin', perm: 'backup.run', group: 'System' },
  { id: 'help', label: 'Help', group: 'System' }, // every role
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
          <CloudRestoreNewComputer />
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
  const allowed = TABS.filter((x) => !x.perm || user.permissions.includes(x.perm)).map((x) => x.id);
  const [lastTab, saveTab] = useRemembered<Tab>('app', 'tab', 'sell', validOneOf(allowed)); // only a tab this user may open
  const [tab, setTab] = useState<Tab>(lastTab);
  // Sell is always open underneath, so it can offer a bill that was left open.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(['sell', lastTab]));
  const show = useCallback((screen: Tab) => {
    setVisited((v) => (v.has(screen) ? v : new Set(v).add(screen)));
    setTab(screen);
    saveTab(screen);
  }, [saveTab]);
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
  const [refundRequest, setRefundRequest] = useState<{ invoice?: string; n: number }>({ n: 0 });
  const openCustomers = useCallback((id?: number) => {
    setCustomerRequest((r) => ({ id, n: r.n + 1 }));
    show('customers');
  }, [show]);
  const openTab = useCallback((screen: Tab) => {
    setCustomerRequest({ n: 0 });
    show(screen);
  }, [show]);
  useEffect(() => void call('ui.screen', { screen: tab }).catch(() => undefined), [tab]); // noted on audit records
  const can = (p: string) => user.permissions.includes(p);
  // Names can be hidden to give screens more room. Sell always opens that way, so checkout keeps its width.
  const [collapsed, setCollapsed] = useRemembered('app', 'navCollapsed', false, validBool);
  const [sellExpanded, setSellExpanded] = useState(false);
  useEffect(() => { if (tab !== 'sell') setSellExpanded(false); }, [tab]);
  const rail = tab === 'sell' ? !sellExpanded : collapsed;
  const toggleRail = () => (tab === 'sell' ? setSellExpanded(!sellExpanded) : setCollapsed(!collapsed));
  const pane = (id: Tab, node: React.ReactNode) => {
    const perm = TABS.find((x) => x.id === id)?.perm;
    return visited.has(id) && (!perm || can(perm)) && <TabPane id={id} active={tab === id}>{node}</TabPane>;
  };
  return (
    <HelpContext.Provider value={openHelp}>
      <KeyboardProvider tab={tab} openTab={openTab} can={can} helpOpen={helpAt !== null} openHelp={openHelp} closeHelp={closeHelp} openCustomers={openCustomers}>
      <div className="shell">
      <aside className={`sidebar${rail ? ' rail' : ''}`}>
        <strong className="brand">POS</strong>
        <nav aria-label="main">
          {TABS.filter((tb) => !tb.perm || can(tb.perm)).map((tb, i, shown) => (
            <span key={tb.id} style={{ display: 'contents' }}>
              {(i === 0 || shown[i - 1]!.group !== tb.group) && <div className="nav-group"><span className="nav-group-text">{t(tb.group)}</span></div>}
              <button className={tab === tb.id ? 'active' : ''} aria-current={tab === tb.id ? 'page' : undefined} aria-label={t(tb.label)} title={rail ? t(tb.label) : undefined} onClick={() => openTab(tb.id)}><NavIcon name={tb.id} /><span className="nav-label">{t(tb.label)}</span></button>
            </span>
          ))}
        </nav>
        <button type="button" className="nav-toggle" aria-label={t(rail ? 'Show menu names' : 'Hide menu names')} title={t(rail ? 'Show menu names' : 'Hide menu names')} onClick={toggleRail}><NavIcon name="collapse" /><span className="nav-label">{t('Hide menu names')}</span></button>
      </aside>
      <div className="shell-main">
      <TopBar>
        <span className="spacer" />
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
      {pane('refund', <Refund canApprove={can('sale.refund')} request={refundRequest} />)}
      {pane('stock', <Stock can={can} />)}
      {pane('products', <Products />)}
      {pane('reports', <Reports />)}
      {pane('customers', <Customers can={can} request={customerRequest} />)}
      {pane('purchases', <Purchases can={can} />)}
      {pane('expenses', <Expenses can={can} />)}
      {pane('accounting', <Accounting />)}
      {pane('shift', <Shift can={can} onUserChange={onAuthChange} />)}
      {pane('admin', <Admin can={can} />)}
      {pane('audit', <Audit books={can('integrity.view') ? <BooksCheck /> : undefined} can={can} openCustomer={(id) => openCustomers(id)} openSale={(invoice) => { setRefundRequest((r) => ({ invoice, n: r.n + 1 })); show('refund'); }} />)}
      {pane('help', <Help />)}
      </div>
      </div>
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
