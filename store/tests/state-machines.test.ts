import { describe, expect, it } from 'vitest';
import { checkTransition, nextStatuses, ORDER_STATUSES, ORDER_TRANSITIONS, TERMINAL_STATUSES, type Actor, type OrderStatus } from '../src/domain/order-machine.ts';
import { canMovePayment, PAYMENT_STATUSES, staffShouldSee } from '../src/domain/payment-machine.ts';

const ALL = new Set(['orders.accept', 'orders.reject', 'orders.fulfil']);
const staff = (from: OrderStatus, to: OrderStatus, extra: Partial<Parameters<typeof checkTransition>[0]> = {}) =>
  checkTransition({ from, to, actor: 'staff', fulfilment: 'delivery', permissions: ALL, reason: 'A reason', ...extra });

describe('order state machine', () => {
  it('has the approved 13 transitions', () => {
    expect(ORDER_TRANSITIONS).toHaveLength(13);
  });

  it('refuses every change that is not in the table', () => {
    const actors: Actor[] = ['staff', 'customer', 'system', 'pos'];
    let refused = 0;
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) for (const actor of actors) {
      if (ORDER_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor)) continue;
      for (const fulfilment of ['delivery', 'pickup'] as const) {
        const r = checkTransition({ from, to, actor, fulfilment, permissions: ALL, reason: 'x' });
        expect(r.ok).toBe(false);
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(500);
  });

  it('nothing leaves a terminal status', () => {
    for (const s of TERMINAL_STATUSES) expect(nextStatuses(s, 'delivery')).toEqual([]);
    expect(TERMINAL_STATUSES).toEqual(['completed', 'rejected', 'cancelled', 'expired']);
  });

  it('cannot skip from placed straight to completed', () => {
    expect(staff('placed', 'completed')).toEqual({ ok: false, code: 'BAD_TRANSITION' });
  });

  it('accepting needs orders.accept', () => {
    expect(staff('placed', 'accepted').ok).toBe(true);
    expect(staff('placed', 'accepted', { permissions: new Set(['orders.fulfil']) })).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('rejecting needs a reason', () => {
    expect(staff('placed', 'rejected', { reason: '  ' })).toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(staff('placed', 'rejected').ok).toBe(true);
  });

  it('only the POS handover can mark out for delivery', () => {
    expect(staff('preparing', 'out_for_delivery')).toEqual({ ok: false, code: 'BAD_TRANSITION' });
    expect(checkTransition({ from: 'preparing', to: 'out_for_delivery', actor: 'pos', fulfilment: 'delivery', permissions: new Set(), reason: null }).ok).toBe(true);
  });

  it('only the POS handover can complete a pickup', () => {
    expect(staff('ready_for_pickup', 'completed', { fulfilment: 'pickup' })).toEqual({ ok: false, code: 'BAD_TRANSITION' });
    expect(checkTransition({ from: 'ready_for_pickup', to: 'completed', actor: 'pos', fulfilment: 'pickup', permissions: new Set(), reason: null }).ok).toBe(true);
  });

  it('fulfilment type decides the path', () => {
    expect(staff('preparing', 'ready_for_pickup', { fulfilment: 'delivery' })).toEqual({ ok: false, code: 'WRONG_FULFILMENT' });
    expect(staff('preparing', 'ready_for_pickup', { fulfilment: 'pickup' }).ok).toBe(true);
    expect(checkTransition({ from: 'preparing', to: 'out_for_delivery', actor: 'pos', fulfilment: 'pickup', permissions: new Set(), reason: null })).toEqual({ ok: false, code: 'WRONG_FULFILMENT' });
  });

  it('a customer can cancel only before acceptance', () => {
    expect(checkTransition({ from: 'placed', to: 'cancelled', actor: 'customer', fulfilment: 'pickup', permissions: new Set(), reason: null }).ok).toBe(true);
    expect(checkTransition({ from: 'accepted', to: 'cancelled', actor: 'customer', fulfilment: 'pickup', permissions: new Set(), reason: null }).ok).toBe(false);
  });

  it('only the system can expire an order', () => {
    expect(staff('placed', 'expired').ok).toBe(false);
    expect(checkTransition({ from: 'placed', to: 'expired', actor: 'system', fulfilment: 'pickup', permissions: new Set(), reason: null }).ok).toBe(true);
  });

  it('lists the next steps for each path', () => {
    expect(nextStatuses('preparing', 'pickup')).toEqual(['ready_for_pickup', 'cancelled']);
    expect(nextStatuses('preparing', 'delivery')).toEqual(['out_for_delivery', 'cancelled']);
  });
});

describe('payment state machine', () => {
  it.each([
    ['pending', 'authorized'],
    ['pending', 'paid'],
    ['pending', 'failed'],
    ['authorized', 'paid'],
    ['authorized', 'cancelled'],
    ['authorized', 'failed'],
    ['due_at_pickup', 'paid'],
    ['due_on_delivery', 'paid'],
    ['paid', 'refund_pending'],
    ['refund_pending', 'refunded'],
    ['refund_pending', 'partially_refunded'],
    ['refund_pending', 'paid'],
    ['partially_refunded', 'refund_pending'],
  ] as const)('%s can become %s', (a, b) => {
    expect(canMovePayment(a, b)).toBe(true);
  });

  it.each([
    ['paid', 'authorized'],
    ['paid', 'pending'],
    ['paid', 'failed'],
    ['authorized', 'pending'],
    ['failed', 'paid'],
    ['refunded', 'paid'],
    ['cancelled', 'paid'],
  ] as const)('a late message cannot move %s back to %s', (a, b) => {
    expect(canMovePayment(a, b)).toBe(false);
  });

  it('a status cannot move to itself, so a repeat does nothing', () => {
    for (const s of PAYMENT_STATUSES) expect(canMovePayment(s, s)).toBe(false);
  });

  it('staff see an order only once its payment is settled or due at handover', () => {
    expect(PAYMENT_STATUSES.filter(staffShouldSee)).toEqual(['authorized', 'paid', 'due_at_pickup', 'due_on_delivery']);
  });
});
