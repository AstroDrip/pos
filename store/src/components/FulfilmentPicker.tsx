'use client';

import { useRef } from 'react';
import { cartActions, useCart } from './cart-store';
import { Button } from './ui';
import { ChevronIcon, PinIcon } from './icons';

export function FulfilmentPicker({ areas }: { areas: { id: string; name: string }[] }) {
  const cart = useCart();
  const dialog = useRef<HTMLDialogElement>(null);
  const area = areas.find((a) => a.id === cart.areaId);
  const pickup = cart.fulfilment === 'pickup';
  const choice = 'flex min-h-11 w-full cursor-pointer items-center rounded-field px-4 text-left font-medium hover:bg-surface-soft';
  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-nav bg-leaf-500 text-ink-900"><PinIcon size={20} /></span>
        <span className="min-w-0">
          <span className="block text-xs text-ink-600">{pickup ? 'Collect from' : 'Deliver to'}</span>
          <span className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{pickup ? 'Store pickup' : area?.name ?? 'Choose your area'}</span><ChevronIcon size={16} /></span>
        </span>
      </button>
      <dialog ref={dialog} aria-label="Delivery or pickup" className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card p-5 backdrop:bg-ink-900/40">
        <h2 className="text-lg font-bold">How would you like your order?</h2>
        <p className="mt-4 text-sm font-semibold text-ink-600">Delivery to</p>
        <ul className="mt-1">
          {areas.map((a) => (
            <li key={a.id}>
              <button type="button" className={`${choice} ${!pickup && a.id === cart.areaId ? 'bg-brand-100' : ''}`} onClick={() => { cartActions.setFulfilment('delivery', a.id); close(); }}>{a.name}</button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm font-semibold text-ink-600">Or collect it yourself</p>
        <button type="button" className={`${choice} mt-1 ${pickup ? 'bg-brand-100' : ''}`} onClick={() => { cartActions.setFulfilment('pickup', null); close(); }}>Store pickup</button>
        <Button type="button" variant="secondary" className="mt-5 w-full" onClick={close}>Close</Button>
      </dialog>
    </>
  );
}
