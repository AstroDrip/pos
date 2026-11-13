import type { OrderFulfilment, OrderStatus } from './order-machine.ts';
import type { PaymentStatus } from './payment-machine.ts';

// What the shopper reads. "Confirmed" is never said before the store accepts.

export const STATUS_TEXT: Record<OrderStatus, { title: string; detail: string }> = {
  placed: { title: 'Order received — waiting for store acceptance', detail: 'The store will check your order shortly.' },
  accepted: { title: 'The store has accepted your order', detail: 'It will be prepared soon.' },
  preparing: { title: 'Your items are being collected', detail: 'The store is preparing your order.' },
  ready_for_pickup: { title: 'Ready for pickup', detail: 'Come to the store and give your order number.' },
  out_for_delivery: { title: 'Out for delivery', detail: 'Your order has left the store.' },
  completed: { title: 'Completed', detail: 'Thank you for shopping with us.' },
  rejected: { title: 'The store could not accept this order', detail: 'Nothing has been charged.' },
  cancelled: { title: 'Cancelled', detail: 'This order was cancelled.' },
  expired: { title: 'This order expired', detail: 'The store could not accept it in time. Nothing has been charged.' },
};

export const STEP_LABEL: Record<OrderStatus, string> = {
  placed: 'Received',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const STEPS: Record<OrderFulfilment, OrderStatus[]> = {
  pickup: ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed'],
  delivery: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'completed'],
};

export const PAYMENT_TEXT: Record<PaymentStatus, string> = {
  pending: 'Waiting for payment',
  authorized: 'Payment held, not yet taken',
  paid: 'Paid',
  failed: 'Payment failed',
  cancelled: 'Nothing to pay',
  due_at_pickup: 'Pay when you collect',
  due_on_delivery: 'Pay on delivery',
  refund_pending: 'Refund in progress',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
};

export const METHOD_TEXT: Record<string, string> = {
  pay_at_pickup: 'Pay at the store when you collect',
  cash_on_delivery: 'Cash on delivery',
  card: 'Card',
  mada: 'mada',
  apple_pay: 'Apple Pay',
  stc_pay: 'STC Pay',
};
