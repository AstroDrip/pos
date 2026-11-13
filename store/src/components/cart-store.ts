'use client';

import { useSyncExternalStore } from 'react';
import { addItem, EMPTY_CART, parseCart, setQty, type CartState } from '@/domain/cart';

// The cart lives on this device. Storage can be missing or blocked, and the shop must still work.
const KEY = 'store-cart-v1';
let current: CartState | null = null;
const listeners = new Set<() => void>();

function read(): CartState {
  if (current) return current;
  try {
    current = parseCart(window.localStorage.getItem(KEY));
  } catch {
    current = EMPTY_CART;
  }
  return current;
}

function write(next: CartState) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The cart still works for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = parseCart(e.newValue);
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const useCart = (): CartState => useSyncExternalStore(subscribe, read, () => EMPTY_CART);

export const cartActions = {
  add: (productId: number, qty: number) => write(addItem(read(), productId, qty)),
  set: (productId: number, qty: number) => write(setQty(read(), productId, qty)),
  clear: () => write({ ...read(), items: [] }),
  setFulfilment: (fulfilment: CartState['fulfilment'], areaId: string | null) => write({ ...read(), fulfilment, areaId }),
};
