'use client';

import { stepFor, type SellMode } from '@/domain/cart';
import type { Availability } from '@/server/catalog-core';
import { cartActions, useCart } from './cart-store';
import { MinusIcon, PlusIcon } from './icons';

const MAX_WHEN_UNKNOWN = 99_000;

export function Stepper({ qty, label, onMinus, onPlus, canAdd, name }: { qty: number; label: string; onMinus: () => void; onPlus: () => void; canAdd: boolean; name: string }) {
  const button = 'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center justify-between rounded-full bg-surface-soft">
      <button type="button" className={button} onClick={onMinus} aria-label={`Remove one ${name}`}><MinusIcon size={18} /></button>
      <span className="truncate text-sm font-semibold tabular-nums" aria-live="polite" title={String(qty / 1000)}>{label}</span>
      <button type="button" className={button} onClick={onPlus} disabled={!canAdd} aria-label={`Add one more ${name}`}><PlusIcon size={18} /></button>
    </div>
  );
}

export function canAddMore(qty: number, step: number, a: Availability): boolean {
  return qty + step <= (a.available ?? MAX_WHEN_UNKNOWN);
}

export function AddToCart({ productId, sellMode, unit, availability, compact = false, name = 'item' }: { productId: number; sellMode: SellMode; unit: string; availability: Availability; compact?: boolean; name?: string }) {
  const cart = useCart();
  const qty = cart.items.find((i) => i.productId === productId)?.qty ?? 0;
  const step = stepFor(sellMode);
  const out = availability.state === 'out';
  // Weighed goods start at one kilo, which is how they are priced on the shelf.
  const first = sellMode === 'weight' ? 1000 : step;

  if (qty > 0) {
    const label = sellMode === 'weight' ? `${qty / 1000} ${unit}` : String(qty / 1000);
    return <Stepper qty={qty} label={label} name={name} onMinus={() => cartActions.set(productId, qty - step)} onPlus={() => cartActions.add(productId, step)} canAdd={canAddMore(qty, step, availability)} />;
  }
  return (
    <button
      type="button"
      disabled={out || !canAddMore(0, first, availability)}
      onClick={() => cartActions.add(productId, first)}
      className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-1 rounded-full font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed ${out ? 'bg-surface-soft text-ink-600' : 'bg-brand-900 text-white hover:bg-brand-700'} ${compact ? 'text-sm' : ''}`}
    >
      {out ? 'Unavailable' : <><PlusIcon size={18} /> Add</>}
    </button>
  );
}
