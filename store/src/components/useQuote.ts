'use client';

import { useEffect, useState } from 'react';
import type { CartState } from '@/domain/cart';
import type { CartQuote } from '@/server/cart-core';
import { cartActions } from './cart-store';

/** Asks the server to price the cart whenever it changes. The last good answer stays on screen if a request fails. */
export function useQuote(cart: CartState): { quote: CartQuote | null; updating: boolean; failed: boolean; refresh: () => void } {
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [updating, setUpdating] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(cart);

  useEffect(() => {
    const now = JSON.parse(key) as CartState;
    if (now.items.length === 0) return;
    const stop = new AbortController();
    const timer = setTimeout(async () => {
      setUpdating(true);
      try {
        const r = await fetch('/api/store/quote', { method: 'POST', signal: stop.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fulfilment: now.fulfilment, ...(now.fulfilment === 'delivery' && now.areaId ? { areaId: now.areaId } : {}), lines: now.items }) });
        const data = (await r.json()) as CartQuote & { error?: string };
        if (data.error === 'BAD_AREA') {
          cartActions.setFulfilment('delivery', null); // the area stopped being offered
          return;
        }
        if (!r.ok) throw new Error(data.error);
        setQuote(data);
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setFailed(true);
      } finally {
        if (!stop.signal.aborted) setUpdating(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [key, tick]);

  return { quote, updating, failed, refresh: () => setTick((n) => n + 1) };
}
