'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { formatMoney } from '../../../src/core/money';
import { qtyLabel, stepFor } from '@/domain/cart';
import type { CartLineView } from '@/server/cart-core';
import { canAddMore, Stepper } from './AddToCart';
import { cartActions, useCart } from './cart-store';
import { FreeDeliveryProgress } from './FreeDeliveryProgress';
import { ProductImage } from './ProductCard';
import { EmptyState } from './shop-parts';
import { TrashIcon } from './icons';
import { Button } from './ui';
import { useQuote } from './useQuote';

function issueText(l: CartLineView): string | null {
  if (l.issue === 'unavailable') return 'No longer available. Please remove it.';
  if (l.issue === 'short') return l.sellMode === 'unit' ? `Only ${Math.floor(l.availability.available! / 1000)} left. Please lower the quantity.` : 'Not enough left. Please lower the quantity.';
  return null;
}

function Line({ line }: { line: CartLineView }) {
  const step = stepFor(line.sellMode);
  const problem = issueText(line);
  return (
    <li className="flex gap-3 border-b border-line py-4">
      <Link href={`/products/${line.productId}`} className="w-20 shrink-0" aria-label={line.name}><ProductImage src={line.imageUrl} alt="" small /></Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium">{line.name}</h3>
          <button type="button" onClick={() => cartActions.set(line.productId, 0)} aria-label={`Remove ${line.name}`} className="-mt-2 -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center text-ink-600 hover:text-danger"><TrashIcon size={18} /></button>
        </div>
        {line.unit && <p className="text-xs text-ink-600">{formatMoney(line.unitPriceIncl)} / {line.unit}{line.isEstimate ? `. ${qtyLabel(line.qty, line.sellMode, line.unit)}, final price after weighing` : ''}</p>}
        {problem && <p role="alert" className="mt-1 text-xs font-medium text-danger">{problem}</p>}
        {line.issue !== 'unavailable' && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="w-36"><Stepper qty={line.qty} label={line.sellMode === 'weight' ? `${line.qty / 1000} ${line.unit}` : String(line.qty / 1000)} name={line.name} onMinus={() => cartActions.set(line.productId, line.qty - step)} onPlus={() => cartActions.set(line.productId, line.qty + step)} canAdd={canAddMore(line.qty, step, line.availability)} /></div>
            <p className="shrink-0 text-right font-bold">{line.isEstimate && <span className="block text-xs font-normal text-ink-600">About</span>}{formatMoney(line.lineIncl)}</p>
          </div>
        )}
      </div>
    </li>
  );
}

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`flex justify-between gap-4 ${strong ? 'mt-2 border-t border-line pt-3 text-lg font-bold' : 'mt-1 text-sm'}`}>
    <dt className={strong ? '' : 'text-ink-600'}>{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);

export function CartView() {
  const cart = useCart();
  const { quote, updating, failed } = useQuote(cart);
  const clearDialog = useRef<HTMLDialogElement>(null);

  if (cart.items.length === 0) {
    return (
      <EmptyState title="Your cart is empty">
        <p>Add something fresh to get started.</p>
        <Link href="/categories" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-900 px-6 font-semibold text-white">Browse categories</Link>
      </EmptyState>
    );
  }

  const segment = (active: boolean) => `min-h-11 flex-1 cursor-pointer rounded-full text-sm font-semibold ${active ? 'bg-brand-900 text-white' : 'text-ink-900'}`;
  const delivery = cart.fulfilment === 'delivery';

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
      <div>
        <div className="flex rounded-full bg-surface-soft p-1">
          <button type="button" className={segment(delivery)} onClick={() => cartActions.setFulfilment('delivery', cart.areaId)}>Delivery</button>
          <button type="button" className={segment(!delivery)} onClick={() => cartActions.setFulfilment('pickup', null)}>Store pickup</button>
        </div>
        {failed && <p role="alert" className="mt-3 rounded-field bg-surface-soft p-3 text-sm text-danger">We could not update this. Your cart is safe.</p>}
        {quote ? <ul className="mt-2">{quote.lines.map((l) => <Line key={l.productId} line={l} />)}</ul> : !failed && <p className="py-10 text-center text-ink-600">Loading your cart</p>}
        <div className="mt-2 flex items-center justify-between">
          <Link href="/categories" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">Continue shopping</Link>
          <button type="button" onClick={() => clearDialog.current?.showModal()} className="min-h-11 cursor-pointer text-sm font-medium text-ink-600">Clear cart</button>
        </div>
      </div>

      {quote && (
        <aside className="mt-4 space-y-4 lg:sticky lg:top-24 lg:mt-0 lg:self-start">
          {delivery && !quote.deliveryUnavailable && <FreeDeliveryProgress facts={quote} updating={updating} />}
          {quote.deliveryUnavailable && <p role="alert" className="rounded-field bg-surface-soft p-3 text-sm text-warning">Delivery is not available right now. Please choose store pickup.</p>}
          <section aria-label="Order summary" aria-busy={updating} className="rounded-card border border-line p-4">
            <dl>
              <Row label="Items" value={formatMoney(quote.itemsIncl)} />
              {delivery && !quote.deliveryUnavailable && <Row label="Delivery" value={quote.freeDelivery ? 'Free' : formatMoney(quote.deliveryFeeIncl)} />}
              <Row label="Total" value={formatMoney(quote.totalIncl)} strong />
              <Row label="Includes VAT" value={formatMoney(quote.totalVat)} />
            </dl>
            {!quote.stockFresh && <p className="mt-3 text-sm text-warning">Online ordering is paused while we update stock.</p>}
            {quote.canCheckout && !updating ? (
              <Link href="/checkout" className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full bg-brand-900 font-semibold text-white hover:bg-brand-700">Checkout</Link>
            ) : (
              <Button type="button" disabled className="mt-4 w-full">{updating ? 'Updating' : 'Checkout'}</Button>
            )}
            {!quote.canCheckout && quote.lines.some((l) => l.issue) && <p className="mt-2 text-sm text-danger">Fix the items marked above to check out.</p>}
          </section>
        </aside>
      )}

      <dialog ref={clearDialog} aria-label="Clear cart" className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card p-5 backdrop:bg-ink-900/40">
        <h2 className="text-lg font-bold">Clear your cart?</h2>
        <p className="mt-1 text-ink-600">This removes every item.</p>
        <div className="mt-5 flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => clearDialog.current?.close()}>Keep items</Button>
          <Button type="button" className="flex-1" onClick={() => { cartActions.clear(); clearDialog.current?.close(); }}>Clear</Button>
        </div>
      </dialog>
    </div>
  );
}
