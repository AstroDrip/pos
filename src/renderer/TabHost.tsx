import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { memoryKey, readMemory, validPositions, writeMemory, type StorageLike } from './remember';

// Every tab that has been opened stays mounted and is hidden while another tab is showing, so nothing typed or chosen
// is lost by moving around. The whole set is keyed by user in App, so logging out destroys it.

const TabActiveContext = createContext(true);
const UserContext = createContext<{ id: number }>({ id: 0 });
export const UserProvider = UserContext.Provider;

/** True while this screen is the one showing. Screens outside a tab, such as the Help overlay, are always active. */
export const useTabActive = () => useContext(TabActiveContext);
export const useUser = () => useContext(UserContext);

/** Runs when a hidden tab is shown again, not on first opening. */
export function useOnReturn(fn: () => void): void {
  const active = useTabActive();
  const was = useRef(active);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (active && !was.current) latest.current();
    was.current = active;
  }, [active]);
}

/** Goes up each time a hidden tab is shown again. Put it in an effect's list so its data is read afresh. */
export function useReturnTick(): number {
  const [n, setN] = useState(0);
  useOnReturn(() => setN((x) => x + 1));
  return n;
}

const noStore: StorageLike = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
function store(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return noStore; // storage can be blocked: the app then simply remembers nothing
  }
}

/** A value kept for this user across restarts. Never for PINs or passwords. */
export function useRemembered<T>(tab: string, key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const { id } = useUser();
  const k = memoryKey(id, tab, key);
  const [value, setValue] = useState<T>(() => readMemory(store(), k, initial, valid));
  const set = useCallback((v: T) => {
    setValue(v);
    writeMemory(store(), k, v);
  }, [k]);
  return [value, set];
}

export function TabPane({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(active);
  const { id: userId } = useUser();
  const scrollKey = memoryKey(userId, id, 'scroll');
  // Positions are noted as they change, because a hidden element no longer has one to read.
  const positions = useRef<Record<string, number>>(readMemory(store(), scrollKey, {}, validPositions));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const note = (name: string, y: number) => {
    positions.current[name] = y;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeMemory(store(), scrollKey, positions.current), 200);
  };
  useEffect(() => {
    if (!active) return undefined;
    requestAnimationFrame(() => {
      for (const el of ref.current?.querySelectorAll<HTMLElement>('[data-keep-scroll]') ?? []) el.scrollTop = positions.current[el.dataset.keepScroll!] ?? 0;
      window.scrollTo(0, positions.current.page ?? 0);
    });
    const onPage = () => note('page', window.scrollY);
    window.addEventListener('scroll', onPage, { passive: true });
    return () => window.removeEventListener('scroll', onPage);
  }, [active]);
  useEffect(() => {
    if (active && !was.current) {
      // The screen moves focus itself if it needs a particular box; otherwise its main box gets it.
      requestAnimationFrame(() => {
        const current = document.activeElement;
        if (current && current !== document.body && current.closest('[hidden]') === null && current.closest('nav') === null) return; // a click on a tab leaves focus on the tab button
        const box = [...(ref.current?.querySelectorAll<HTMLElement>('[data-kb-search]') ?? [])].find((el) => el.offsetParent !== null && !(el as HTMLInputElement).disabled);
        box?.focus();
      });
    }
    was.current = active;
  }, [active]);
  return (
    <div
      ref={ref}
      data-tab={id}
      hidden={!active}
      style={{ display: active ? 'contents' : 'none' }}
      onScrollCapture={(e) => {
        const el = e.target as HTMLElement;
        if (el.dataset?.keepScroll) note(el.dataset.keepScroll, el.scrollTop);
      }}
    >
      <TabActiveContext.Provider value={active}>{children}</TabActiveContext.Provider>
    </div>
  );
}
