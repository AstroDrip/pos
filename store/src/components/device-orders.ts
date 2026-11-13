'use client';

// Orders placed on this device, so the shopper can find them again. Holds only the order number and its private key.
const KEY = 'store-orders-v1';

export interface DeviceOrder {
  ref: string;
  token: string;
  placedAt: string;
}

export function readDeviceOrders(): DeviceOrder[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as DeviceOrder[];
    return Array.isArray(v) ? v.filter((o) => typeof o?.ref === 'string' && typeof o?.token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberOrder(o: DeviceOrder): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([o, ...readDeviceOrders().filter((x) => x.ref !== o.ref)].slice(0, 20)));
  } catch {
    // The private link still works for this visit.
  }
}

export const tokenFor = (ref: string): string | null => readDeviceOrders().find((o) => o.ref === ref)?.token ?? null;

/** A long random secret made in the browser. Only its fingerprint is stored by the store. */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
