// Small per-user screen memory (filters, last article, last tab). Never used for PINs, passwords or anything that
// must not be lost: bills live in SQLite (see services/drafts.ts). A bad or blocked store simply means a fresh start.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const memoryKey = (userId: number, tab: string, key: string): string => `pos.ui.${userId}.${tab}.${key}`;

export function readMemory<T>(store: StorageLike, k: string, initial: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = store.getItem(k);
    if (raw === null) return initial;
    const v: unknown = JSON.parse(raw);
    if (valid(v)) return v;
    store.removeItem(k);
  } catch {
    try {
      store.removeItem(k);
    } catch {
      // a blocked store: nothing to clean
    }
  }
  return initial;
}

export function writeMemory(store: StorageLike, k: string, v: unknown): void {
  try {
    store.setItem(k, JSON.stringify(v));
  } catch {
    // only a convenience: a full or blocked store must never stop the till
  }
}
