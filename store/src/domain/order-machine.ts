// The one order state machine, as approved in docs/ecommerce/ORDER_AND_PAYMENT_STATE_MACHINE.md.
// A change that is not in this table does not happen.

export const ORDER_STATUSES = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'rejected', 'cancelled', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Actor = 'staff' | 'customer' | 'system' | 'pos';
export type OrderFulfilment = 'delivery' | 'pickup';

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['completed', 'rejected', 'cancelled', 'expired'];

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  actor: Actor;
  permission?: string;
  fulfilment?: OrderFulfilment;
  needsReason?: boolean;
}

const REJECT = { actor: 'staff', permission: 'orders.reject', needsReason: true } as const;
const FULFIL = { actor: 'staff', permission: 'orders.fulfil' } as const;

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  { from: 'placed', to: 'accepted', actor: 'staff', permission: 'orders.accept' },
  { from: 'placed', to: 'rejected', ...REJECT },
  { from: 'placed', to: 'cancelled', actor: 'customer' },
  { from: 'placed', to: 'expired', actor: 'system' },
  { from: 'accepted', to: 'preparing', ...FULFIL },
  { from: 'accepted', to: 'cancelled', ...REJECT },
  { from: 'preparing', to: 'ready_for_pickup', ...FULFIL, fulfilment: 'pickup' },
  { from: 'preparing', to: 'out_for_delivery', actor: 'pos', fulfilment: 'delivery' },
  { from: 'preparing', to: 'cancelled', ...REJECT },
  { from: 'ready_for_pickup', to: 'completed', actor: 'pos', fulfilment: 'pickup' },
  { from: 'ready_for_pickup', to: 'cancelled', ...REJECT },
  { from: 'out_for_delivery', to: 'completed', ...FULFIL },
  { from: 'out_for_delivery', to: 'cancelled', ...REJECT },
];

export interface TransitionRequest {
  from: OrderStatus;
  to: OrderStatus;
  actor: Actor;
  fulfilment: OrderFulfilment;
  permissions: ReadonlySet<string>;
  reason: string | null;
}

export type TransitionResult = { ok: true; transition: OrderTransition } | { ok: false; code: 'BAD_TRANSITION' | 'WRONG_FULFILMENT' | 'FORBIDDEN' | 'REASON_REQUIRED' };

export function checkTransition(r: TransitionRequest): TransitionResult {
  const t = ORDER_TRANSITIONS.find((x) => x.from === r.from && x.to === r.to && x.actor === r.actor);
  if (!t) return { ok: false, code: 'BAD_TRANSITION' };
  if (t.fulfilment && t.fulfilment !== r.fulfilment) return { ok: false, code: 'WRONG_FULFILMENT' };
  if (t.permission && !r.permissions.has(t.permission)) return { ok: false, code: 'FORBIDDEN' };
  if (t.needsReason && !r.reason?.trim()) return { ok: false, code: 'REASON_REQUIRED' };
  return { ok: true, transition: t };
}

/** Statuses an order can move to next, on its own delivery or pickup path. */
export function nextStatuses(from: OrderStatus, fulfilment: OrderFulfilment): OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from && (!t.fulfilment || t.fulfilment === fulfilment)).map((t) => t.to);
}
