'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { formatMoney } from '../../../src/core/money';
import { METHOD_TEXT } from '@/domain/order-text';
import { normalisePhone } from '@/domain/phone';
import { cartActions, useCart } from './cart-store';
import { newSecret, rememberOrder } from './device-orders';
import { FreeDeliveryProgress } from './FreeDeliveryProgress';
import { EmptyState } from './shop-parts';
import { Button } from './ui';
import { useQuote } from './useQuote';

interface Props {
  areas: { id: string; name: string }[];
  pickupMethods: string[];
  deliveryMethods: string[];
}

const ATTEMPT = 'store-checkout-attempt';

/** One key and secret per checkout, kept until it succeeds, so a retry after a network failure cannot make a second order. */
function attempt(): { key: string; token: string } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(ATTEMPT) ?? 'null') as { key: string; token: string } | null;
    if (saved?.key && saved.token) return saved;
  } catch {
    /* start a new one */
  }
  const fresh = { key: newSecret().slice(0, 32), token: newSecret() };
  try {
    window.sessionStorage.setItem(ATTEMPT, JSON.stringify(fresh));
  } catch {
    /* fine for this visit */
  }
  return fresh;
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line p-4 lg:p-5" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-lg font-bold">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-900 text-sm text-white">{n}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Input({ label, error, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string }) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-e` : undefined} className={`min-h-11 w-full rounded-field bg-surface-soft px-4 placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-brand-700 ${error ? 'outline-2 outline-danger' : ''}`} {...rest} />
      {hint && !error && <p className="mt-1 text-xs text-ink-600">{hint}</p>}
      {error && <p id={`${id}-e`} className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

const MESSAGES: Record<string, string> = {
  PRICE_CHANGED: 'A price changed since you looked. Please check the new total, then place the order again.',
  OUT_OF_STOCK: 'Some items sold out in that amount. Please check your cart.',
  CHECKOUT_CLOSED: 'Online ordering is paused while we update stock. Your cart is safe. Please try again soon.',
  DELIVERY_UNAVAILABLE: 'Delivery is not available right now. Please choose store pickup.',
  PAYMENT_METHOD: 'That payment method is not available for this order.',
  TOO_MANY_OPEN_ORDERS: 'You already have several open orders. Please wait until they are completed.',
  RATE_LIMITED: 'Too many orders from here. Please try again later.',
  BAD_AREA: 'We do not deliver to that area. Please choose another.',
  INVALID: 'Please check your details.',
};

export function CheckoutView({ areas, pickupMethods, deliveryMethods }: Props) {
  const router = useRouter();
  const cart = useCart();
  const { quote, updating, failed, refresh } = useQuote(cart);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [building, setBuilding] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const delivery = cart.fulfilment === 'delivery';
  const methods = delivery ? deliveryMethods : pickupMethods;
  const chosen = method && methods.includes(method) ? method : (methods[0] ?? null);

  useEffect(() => setProblem(null), [cart.fulfilment, cart.areaId]);

  if (cart.items.length === 0 && !sending) {
    return (
      <EmptyState title="Your cart is empty">
        <p>Add something before checking out.</p>
        <Link href="/categories" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-900 px-6 font-semibold text-white">Browse categories</Link>
      </EmptyState>
    );
  }

  const check = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Enter your name.';
    if (!normalisePhone(phone)) e.phone = 'Enter a Saudi mobile number, such as 05X XXX XXXX.';
    if (delivery && !cart.areaId) e.area = 'Choose your delivery area.';
    if (delivery && !addressLine.trim()) e.address = 'Enter your street and house or flat.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const placeOrder = async () => {
    setProblem(null);
    if (!quote || !chosen || !check()) return;
    setSending(true);
    const a = attempt();
    try {
      const r = await fetch('/api/store/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: a.key,
          accessToken: a.token,
          fulfilment: cart.fulfilment,
          ...(delivery ? { areaId: cart.areaId, addressLine: addressLine.trim(), building: building.trim() } : {}),
          ...(note.trim() ? { locationNote: note.trim() } : {}),
          customerName: name.trim(),
          phone,
          paymentMethod: chosen,
          lines: cart.items,
          expectedTotal: quote.totalIncl,
        }),
      });
      const data = (await r.json()) as { publicRef?: string; error?: string };
      if (!r.ok || !data.publicRef) {
        setProblem(MESSAGES[data.error ?? ''] ?? 'Something went wrong. Your cart is safe. Please try again.');
        if (data.error === 'PRICE_CHANGED' || data.error === 'OUT_OF_STOCK') {
          window.sessionStorage.removeItem(ATTEMPT);
          refresh();
        }
        setSending(false);
        return;
      }
      rememberOrder({ ref: data.publicRef, token: a.token, placedAt: new Date().toISOString() });
      window.sessionStorage.removeItem(ATTEMPT);
      router.push(`/orders/${data.publicRef}?new=1#${a.token}`);
      cartActions.clear();
    } catch {
      setProblem('We could not reach the store. Your cart is safe. Press Place order to try again.');
      setSending(false);
    }
  };

  const choice = (active: boolean) => `min-h-11 flex-1 cursor-pointer rounded-full text-sm font-semibold ${active ? 'bg-brand-900 text-white' : 'text-ink-900'}`;
  const ready = Boolean(quote?.canCheckout && chosen && !updating && !failed);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
      <div className="space-y-4">
        <Section n={1} title="Delivery or pickup">
          <div className="flex rounded-full bg-surface-soft p-1">
            <button type="button" className={choice(delivery)} onClick={() => cartActions.setFulfilment('delivery', cart.areaId)}>Delivery</button>
            <button type="button" className={choice(!delivery)} onClick={() => cartActions.setFulfilment('pickup', null)}>Store pickup</button>
          </div>
          {delivery ? (
            <div>
              <label htmlFor="area" className="mb-1 block text-sm font-medium">Delivery area</label>
              <select id="area" value={cart.areaId ?? ''} aria-invalid={Boolean(errors.area)} onChange={(e) => cartActions.setFulfilment('delivery', e.target.value || null)} className="min-h-11 w-full cursor-pointer rounded-field bg-surface-soft px-4 focus-visible:outline-2 focus-visible:outline-brand-700">
                <option value="">Choose your area</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {errors.area && <p className="mt-1 text-sm text-danger">{errors.area}</p>}
            </div>
          ) : (
            <p className="text-sm text-ink-600">Collect your order from the store. We will show here when it is ready.</p>
          )}
        </Section>

        <Section n={2} title="Your details">
          <Input label="Full name" autoComplete="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} error={errors.phone} hint="The store calls this number if there is a question about your order." />
        </Section>

        <Section n={3} title={delivery ? 'Delivery address' : 'Pickup details'}>
          {delivery && (
            <>
              <Input label="Street and house or flat" autoComplete="street-address" value={addressLine} maxLength={200} onChange={(e) => setAddressLine(e.target.value)} error={errors.address} />
              <Input label="Building, floor (optional)" value={building} maxLength={80} onChange={(e) => setBuilding(e.target.value)} />
            </>
          )}
          <Input label={delivery ? 'Directions for the driver (optional)' : 'Anything the store should know? (optional)'} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Section>

        <Section n={4} title="Payment">
          {methods.length === 0 ? (
            <p role="status" className="rounded-field bg-surface-soft p-3 text-sm text-ink-600">
              {delivery ? 'Online card payment is coming soon, and delivery orders open then. For now, please choose store pickup and pay when you collect.' : 'Paying at pickup is switched off at the moment. Please contact the store.'}
            </p>
          ) : (
            <fieldset>
              <legend className="sr-only">Payment method</legend>
              {methods.map((m) => (
                <label key={m} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-field border px-4 py-2 ${chosen === m ? 'border-brand-900 bg-brand-100' : 'border-line'}`}>
                  <input type="radio" name="method" aria-label={METHOD_TEXT[m] ?? m} checked={chosen === m} onChange={() => setMethod(m)} className="size-4 accent-brand-900" />
                  <span>
                    <span className="block font-medium">{METHOD_TEXT[m] ?? m}</span>
                    {m === 'pay_at_pickup' && <span className="block text-xs text-ink-600">Cash or card. Weighed items are charged at their exact weight.</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </Section>
      </div>

      <aside className="mt-4 space-y-4 lg:sticky lg:top-24 lg:mt-0 lg:self-start">
        {quote && delivery && !quote.deliveryUnavailable && <FreeDeliveryProgress facts={quote} updating={updating} />}
        <section aria-label="Order summary" aria-busy={updating} className="rounded-card border border-line p-4">
          <h2 className="font-bold">Review</h2>
          {quote ? (
            <>
              <ul className="mt-2 space-y-1 text-sm">
                {quote.lines.map((l) => (
                  <li key={l.productId} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{l.name} <span className="text-ink-600">× {l.sellMode === 'weight' ? `${l.qty / 1000} ${l.unit}` : l.qty / 1000}</span></span>
                    <span className="shrink-0 tabular-nums">{l.isEstimate ? 'About ' : ''}{formatMoney(l.lineIncl)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 border-t border-line pt-3 text-sm">
                <div className="flex justify-between"><dt className="text-ink-600">Items</dt><dd className="tabular-nums">{formatMoney(quote.itemsIncl)}</dd></div>
                {delivery && <div className="mt-1 flex justify-between"><dt className="text-ink-600">Delivery</dt><dd className="tabular-nums">{quote.freeDelivery ? 'Free' : formatMoney(quote.deliveryFeeIncl)}</dd></div>}
                <div className="mt-2 flex justify-between text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(quote.totalIncl)}</dd></div>
                <div className="mt-1 flex justify-between"><dt className="text-ink-600">Includes VAT</dt><dd className="tabular-nums">{formatMoney(quote.totalVat)}</dd></div>
              </dl>
              {quote.lines.some((l) => l.isEstimate) && <p className="mt-2 text-xs text-ink-600">Items sold by weight are estimates. The final price is set after weighing.</p>}
              {!quote.stockFresh && <p className="mt-3 text-sm text-warning">Online ordering is paused while we update stock. Your cart is safe.</p>}
              {quote.lines.some((l) => l.issue) && <p className="mt-3 text-sm text-danger">Some items are not available in that amount. <Link href="/cart" className="underline">Check your cart</Link>.</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-600">{failed ? 'We could not price your cart. Please try again.' : 'Pricing your cart'}</p>
          )}
          {problem && <p role="alert" className="mt-3 rounded-field bg-surface-soft p-3 text-sm text-danger">{problem}</p>}
          <Button type="button" className="mt-4 w-full" disabled={!ready || sending} onClick={() => void placeOrder()}>{sending ? 'Placing order' : 'Place order'}</Button>
          <p className="mt-2 text-xs text-ink-600">The store checks your order before accepting it. Nothing is charged online.</p>
        </section>
        <Link href="/cart" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">Edit cart</Link>
      </aside>
    </div>
  );
}
