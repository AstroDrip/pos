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

export const validText = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
export const validBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const validId = (v: unknown): v is number | null => v === null || (Number.isInteger(v) && (v as number) > 0);
export const validSupplierId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
export function validDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
export const validOneOf = <T extends string>(allowed: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v);
export const validPositions = (v: unknown): v is Record<string, number> => typeof v === 'object' && v !== null && Object.values(v).every((n) => typeof n === 'number');
