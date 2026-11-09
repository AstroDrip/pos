import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { resolveBindings, type Bindings, type ShortcutOverrides } from '../core/shortcuts';
import { call } from './api';
import { KeyHub } from './key-hub';
import { CONTEXT_HELP, decideGlobal, keyLike, type ActionId, type FocusKind, type ScreenContext, type ScreenState } from './keyboard-registry';
import type { CheckoutStep } from './checkout-keys';
import { useI18n } from './i18n';
import { QuickActions } from './QuickActions';

export interface ScreenSnapshot extends ScreenState {
  step?: CheckoutStep;
  busy?: boolean;
  held?: { id: number; label: string }[];
  /** True until the screen has what it needs to run an action. */
  loading?: boolean;
}

/** What a screen tells the keyboard system. Screens without special needs register nothing. */
export interface ScreenKeys {
  state: () => ScreenSnapshot;
  run?: (id: ActionId, arg?: number) => void;
  focusQty?: () => void;
  focusCustomer?: () => void;
  notify?: (text: string) => void;
}

interface KeyboardApi {
  hub: KeyHub;
  register: (s: ScreenKeys) => () => void;
  /** Set while Item information is open: a scan then looks the item up instead of adding it to the bill. */
  scanTarget: RefObject<((code: string) => boolean) | null>;
  openCustomers: (customerId?: number) => void;
  bindings: Bindings;
  overrides: ShortcutOverrides;
  setOverrides: (o: ShortcutOverrides) => void;
}

const Ctx = createContext<KeyboardApi | null>(null);

function useKeyboard(): KeyboardApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('KeyboardProvider is missing');
  return v;
}

/** Lets a screen take part in the shortcuts. Always reads the screen's latest state. */
export function useScreenKeys(get: () => ScreenKeys): void {
  const { register } = useKeyboard();
  const latest = useRef(get);
  latest.current = get;
  useEffect(
    () =>
      register({
        state: () => latest.current().state(),
        run: (id, arg) => latest.current().run?.(id, arg),
        focusQty: () => latest.current().focusQty?.(),
        focusCustomer: () => latest.current().focusCustomer?.(),
        notify: (text) => latest.current().notify?.(text),
      }),
    [register],
  );
}

/** Barcode scanner hook for the Sell screen, through the one global listener. */
export function useScanner(fn: (e: KeyboardEvent, scanTarget: KeyboardApi['scanTarget']) => boolean): void {
  const { hub, scanTarget } = useKeyboard();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => hub.setScanner((e) => latest.current(e, scanTarget)), [hub, scanTarget]);
}

export const useOpenCustomers = () => useKeyboard().openCustomers;
/** The keys in force on this till. */
export const useBindings = () => useKeyboard().bindings;
export function useShortcuts() {
  const { overrides, setOverrides } = useKeyboard();
  return { overrides, setOverrides };
}
export function useKeyRecorder() {
  const { hub } = useKeyboard();
  return useCallback((fn: (e: KeyboardEvent) => void) => hub.setRecorder(fn), [hub]);
}

/** How long a letter waits for its screen to load. After that it is dropped, never run late. */
const OPEN_WAIT_MS = 3000;

const VISIBLE = (el: HTMLElement) => el.offsetParent !== null && !(el as HTMLInputElement).disabled;

export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el || !VISIBLE(el)) return false;
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
  return true;
}

/** Focus something that appears after the next render (a section or tab that is about to open). */
export function focusWhenReady(selector: string, fallback?: string): void {
  let tries = 0;
  const tryIt = () => {
    if (focusEl(document.querySelector<HTMLElement>(selector))) return;
    if (++tries < 30) return void requestAnimationFrame(tryIt);
    if (fallback) focusEl(document.querySelector<HTMLElement>(fallback));
  };
  requestAnimationFrame(tryIt);
}

function focusKind(el: Element | null): FocusKind {
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  if (!(el instanceof HTMLInputElement)) return 'none';
  if (el.type === 'password') return 'password';
  if (['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type)) return 'none';
  if (el.hasAttribute('data-kb-suggest') && el.value) return 'suggestWithText';
  if (el.hasAttribute('data-kb-search')) return 'search';
  return el.value ? 'text' : 'emptyText';
}

/** Clears a box the way typing would, so React's state follows. */
function clearInput(el: HTMLInputElement) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The keyboard system for a logged-in user: the single global listener, and Quick Actions. */
export function KeyboardProvider({ tab, openTab, can, helpOpen, openHelp, closeHelp, openCustomers, children }: {
  tab: ScreenContext;
  openTab: (screen: ScreenContext) => void;
  can: (permission: string) => boolean;
  helpOpen: boolean;
  openHelp: (articleId: string) => void;
  closeHelp: () => void;
  openCustomers: (customerId?: number) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const hub = useRef(new KeyHub()).current;
  const screen = useRef<ScreenKeys | null>(null);
  const scanTarget = useRef<((code: string) => boolean) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [palette, setPalette] = useState(false);
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  useEffect(() => void call<ShortcutOverrides>('shortcuts.get').then(setOverrides, () => setOverrides({})), []);

  const register = useCallback((s: ScreenKeys) => {
    screen.current = s;
    return () => {
      if (screen.current === s) screen.current = null;
    };
  }, []);

  const focusPrimary = () => {
    const root: ParentNode = document.querySelector('[aria-modal="true"]:not(.palette)') ?? document;
    return [...root.querySelectorAll<HTMLElement>('[data-kb-search]')].some(focusEl);
  };

  const closePalette = useCallback((restore: boolean) => {
    setPalette(false);
    scanTarget.current = null;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (restore && !focusEl(el)) focusPrimary();
  }, []);

  // Everything the listener needs, read fresh on each key.
  const live = useRef({ tab, helpOpen, palette, openHelp, closeHelp, closePalette, t, bindings });
  live.current = { tab, helpOpen, palette, openHelp, closeHelp, closePalette, t, bindings };

  useEffect(() => {
    hub.setHandler((e) => {
      const l = live.current;
      const snap = screen.current?.state();
      const action = decideGlobal(keyLike(e), {
        context: l.tab,
        paletteOpen: l.palette,
        modalOpen: l.helpOpen || !!document.querySelector('[aria-modal="true"]'),
        focus: focusKind(document.activeElement),
        step: l.tab === 'sell' ? snap?.step : undefined,
        busy: snap?.busy ?? false,
      }, l.bindings);
      if (action.type === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      switch (action.type) {
        case 'help': l.openHelp(CONTEXT_HELP[l.tab]); break;
        case 'palette':
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPalette(true);
          break;
        case 'closePalette': l.closePalette(true); break;
        case 'closeModal': l.closeHelp(); break;
        case 'focusSearch': focusPrimary(); break;
        case 'focusQty': screen.current?.focusQty?.(); break;
        case 'focusCustomer': screen.current?.focusCustomer?.(); break;
        case 'clearSuggest': clearInput(document.activeElement as HTMLInputElement); break;
        case 'refuse':
          screen.current?.notify?.(action.reason === 'qty' ? l.t('Press Enter to add the item, or {0} to cancel.', l.bindings.direct.escape) : l.t('Press {0} to go back to the bill first.', l.bindings.direct.escape));
          break;
      }
    });
    hub.attach(window);
    return () => {
      hub.setHandler(null);
      hub.detach();
    };
  }, [hub]);

  // A letter from another screen: open its screen, wait until that screen is ready, then ask it to act.
  const openAndRun = useCallback((target: ScreenContext, id: ActionId, arg?: number) => {
    screen.current = null; // so the old screen can never receive the action
    openTab(target);
    const started = performance.now();
    const wait = () => {
      if (performance.now() - started > OPEN_WAIT_MS) return;
      const s = live.current.tab === target ? screen.current : null;
      const snap = s?.state();
      if (!s || !snap || snap.loading) return void requestAnimationFrame(wait);
      const why = snap.unavailable[id];
      if (why) s.notify?.(why);
      else s.run?.(id, arg);
    };
    requestAnimationFrame(wait);
  }, [openTab]);

  // Moving to another screen closes the palette; it belongs to the screen it was opened on.
  useEffect(() => closePalette(false), [tab, closePalette]);

  const api = useMemo(() => ({ hub, register, scanTarget, openCustomers, bindings, overrides, setOverrides }), [hub, register, openCustomers, bindings, overrides]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {palette && (
        <QuickActions
          context={tab}
          can={can}
          screen={screen}
          scanTarget={scanTarget}
          bindings={bindings}
          onClose={closePalette}
          openAndRun={openAndRun}
        />
      )}
    </Ctx.Provider>
  );
}
