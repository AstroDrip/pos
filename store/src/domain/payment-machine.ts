// The one payment state model. It is separate from the order status: a paid order can still be preparing.

export const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'cancelled', 'due_at_pickup', 'due_on_delivery', 'refund_pending', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const MOVES: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  pending: ['authorized', 'paid', 'failed', 'cancelled'],
  authorized: ['paid', 'cancelled', 'failed'],
  paid: ['refund_pending'],
  failed: [],
  cancelled: [],
  due_at_pickup: ['paid', 'cancelled'],
  due_on_delivery: ['paid', 'cancelled'],
  refund_pending: ['refunded', 'partially_refunded', 'paid'],
  refunded: [],
  partially_refunded: ['refund_pending'],
};

/** A late or repeated provider message cannot move a payment backwards. */
export function canMovePayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return MOVES[from].includes(to);
}

/** An order waiting for the customer to finish paying is not yet work for the store. */
export function staffShouldSee(status: PaymentStatus): boolean {
  return status === 'authorized' || status === 'paid' || status === 'due_at_pickup' || status === 'due_on_delivery';
}
