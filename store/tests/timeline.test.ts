import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/components/Timeline.tsx';
import type { OrderStatus } from '../src/domain/order-machine.ts';

const states = (fulfilment: 'pickup' | 'delivery', status: OrderStatus, reached: OrderStatus[]) => {
  const html = renderToStaticMarkup(createElement(Timeline, { fulfilment, status, history: reached.map((s) => ({ status: s, at: '2026-11-10T09:00:00.000Z' })) }));
  return [...html.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
};

describe('order timeline', () => {
  it('a new order is on its first step', () => {
    expect(states('pickup', 'placed', ['placed'])).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('a step in progress has the earlier ones done', () => {
    expect(states('delivery', 'preparing', ['placed', 'accepted', 'preparing'])).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
  });

  it('a completed order is done all the way', () => {
    expect(states('pickup', 'completed', ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'completed'])).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('a cancelled order keeps what happened and ends in a stop', () => {
    expect(states('pickup', 'cancelled', ['placed', 'cancelled'])).toEqual(['done', 'stopped']);
    expect(states('delivery', 'cancelled', ['placed', 'accepted', 'preparing', 'cancelled'])).toEqual(['done', 'done', 'done', 'stopped']);
  });
});
