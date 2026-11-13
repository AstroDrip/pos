'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../../src/core/money';
import { TERMINAL_STATUSES } from '@/domain/order-machine';
import { METHOD_TEXT, PAYMENT_TEXT, STATUS_TEXT } from '@/domain/order-text';
import type { CustomerOrder } from '@/server/order-core';
import { tokenFor } from './device-orders';
import { EmptyState } from './shop-parts';
import { Timeline } from './Timeline';
import { Button } from './ui';

const POLL_MS = 15_000;

/** The order page. The private key is read from the address after #, which browsers never send to the server. */
export function OrderView({ publicRef }: { publicRef: string }) {
  const isNew = useSearchParams().get('new') === '1';
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const token = useRef<string | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    const t = token.current;
    if (!t) return;
    try {
      const r = await fetch(`/api/store/orders/${publicRef}`, { headers: { 'x-order-token': t }, cache: 'no-store' });
      if (r.status === 404) {
        setMissing(true);
        return;
      }
      if (!r.ok) throw new Error('failed');
      setOrder((await r.json()) as CustomerOrder);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [publicRef]);

  useEffect(() => {
    const fromLink = window.location.hash.slice(1);
    token.current = /^[\w-]{43,128}$/.test(fromLink) ? fromLink : tokenFor(publicRef);
    if (!token.current) {
      setMissing(true);
      return;
    }
    void load();
  }, [publicRef, load]);

  const finished = order ? TERMINAL_STATUSES.includes(order.status) : false;
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onShow = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [finished, load]);

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const r = await fetch(`/api/store/orders/${publicRef}/cancel`, { method: 'POST', headers: { 'x-order-token': token.current ?? '' } });
      if (!r.ok) setCancelError(((await r.json()) as { message?: string }).message ?? 'This order could not be cancelled.');
      confirm.current?.close();
      await load();
    } catch {
      setCancelError('We could not reach the store. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  if (missing) {
    return (
      <EmptyState title="We could not open this order">
        <p>Open it from the device you ordered on, or use the full link you were given.</p>
        <Link href="/orders" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-900 px-6 font-semibold text-white">Your orders</Link>
      </EmptyState>
    );
  }
  if (!order) return <p className="py-16 text-center text-ink-600">{offline ? 'We could not reach the store. Retrying.' : 'Loading your order'}</p>;

  const text = STATUS_TEXT[order.status];
  const pickup = order.fulfilment === 'pickup';
  const stopped = ['rejected', 'cancelled', 'expired'].includes(order.status);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
      <div className="space-y-4">
        <section role="status" className={`rounded-card p-5 ${stopped ? 'bg-surface-soft' : 'bg-brand-900 text-white'}`}>
          {isNew && order.status === 'placed' && <p className="mb-1 text-sm font-semibold text-leaf-500">Thank you. Your order has been sent to the store.</p>}
          <h2 className="text-xl font-bold">{text.title}</h2>
          <p className={`mt-1 ${stopped ? 'text-ink-600' : 'text-white/90'}`}>{text.detail}</p>
          <p className={`mt-3 text-sm ${stopped ? 'text-ink-600' : 'text-white/90'}`}>Order number <span className="font-bold tracking-wide">{order.publicRef}</span></p>
        </section>
        {offline && <p role="alert" className="rounded-field bg-surface-soft p-3 text-sm text-warning">We could not refresh this page. The details below may be out of date.</p>}

        <section className="rounded-card border border-line p-5">
          <h2 className="mb-4 font-bold">Progress</h2>
          <Timeline fulfilment={order.fulfilment} status={order.status} history={order.history} />
        </section>

        <section className="rounded-card border border-line p-5">
          <h2 className="font-bold">{pickup ? 'Pickup' : 'Delivery'}</h2>
          {pickup ? (
            <p className="mt-1 text-ink-600">Collect from the store. Give your order number <span className="font-semibold text-ink-900">{order.publicRef}</span>.</p>
          ) : (
            <p className="mt-1 text-ink-600">{[order.addressLine, order.building, order.areaName].filter(Boolean).join(', ')}</p>
          )}
          {order.locationNote && <p className="mt-1 text-sm text-ink-600">Note: {order.locationNote}</p>}
          <p className="mt-2 text-sm text-ink-600">{order.customerName}, {order.phone}</p>
        </section>
      </div>

      <aside className="mt-4 space-y-4 lg:mt-0">
        <section className="rounded-card border border-line p-5">
          <h2 className="font-bold">Items</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {order.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0">{l.name} <span className="text-ink-600">× {l.sellMode === 'weight' ? `${l.qty / 1000} ${l.unit}` : l.qty / 1000}</span></span>
                <span className="shrink-0 tabular-nums">{l.isEstimate ? 'About ' : ''}{formatMoney(l.lineIncl)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 border-t border-line pt-3 text-sm">
            {!pickup && <div className="flex justify-between"><dt className="text-ink-600">Delivery</dt><dd className="tabular-nums">{order.deliveryFeeIncl === 0 ? 'Free' : formatMoney(order.deliveryFeeIncl)}</dd></div>}
            <div className="mt-1 flex justify-between text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(order.totalIncl)}</dd></div>
            <div className="mt-1 flex justify-between"><dt className="text-ink-600">Includes VAT</dt><dd className="tabular-nums">{formatMoney(order.totalVat)}</dd></div>
          </dl>
        </section>
        <section className="rounded-card border border-line p-5">
          <h2 className="font-bold">Payment</h2>
          <p className="mt-1">{METHOD_TEXT[order.paymentMethod] ?? order.paymentMethod}</p>
          <p className="text-sm text-ink-600">{PAYMENT_TEXT[order.paymentStatus]}</p>
        </section>
        {order.canCancel && (
          <>
            <Button type="button" variant="secondary" className="w-full" onClick={() => confirm.current?.showModal()}>Cancel order</Button>
            {cancelError && <p role="alert" className="text-sm text-danger">{cancelError}</p>}
          </>
        )}
        <p className="text-xs text-ink-600">Keep this page&apos;s link to check your order later. It also appears under Orders on this device.</p>
      </aside>

      <dialog ref={confirm} aria-label="Cancel order" className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card p-5 backdrop:bg-ink-900/40">
        <h2 className="text-lg font-bold">Cancel this order?</h2>
        <p className="mt-1 text-ink-600">The store will not prepare it.</p>
        <div className="mt-5 flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => confirm.current?.close()}>Keep order</Button>
          <Button type="button" className="flex-1" disabled={cancelling} onClick={() => void cancel()}>Cancel order</Button>
        </div>
      </dialog>
    </div>
  );
}
