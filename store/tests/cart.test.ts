import { describe, expect, it } from 'vitest';
import { addItem, EMPTY_CART, itemCount, parseCart, qtyLabel, setQty, stepFor } from '../src/domain/cart.ts';

describe('cart', () => {
  it('adds a new item and adds to an existing one', () => {
    const a = addItem(EMPTY_CART, 1, 1000);
    expect(addItem(a, 1, 1000).items).toEqual([{ productId: 1, qty: 2000 }]);
  });

  it('removes an item when its quantity reaches zero', () => {
    expect(setQty(addItem(EMPTY_CART, 1, 1000), 1, 0).items).toEqual([]);
  });

  it('counts lines, not grams', () => {
    expect(itemCount(addItem(addItem(EMPTY_CART, 1, 2500), 2, 1000))).toBe(2);
  });

  it('whole units step by one and weighed goods by half a kilo', () => {
    expect(stepFor('unit')).toBe(1000);
    expect(stepFor('weight')).toBe(500);
  });

  it('labels quantities the way a shopper says them', () => {
    expect(qtyLabel(2000, 'unit', 'piece')).toBe('2');
    expect(qtyLabel(1500, 'weight', 'kg')).toBe('About 1.5 kg');
    expect(qtyLabel(1000, 'weight', 'kg')).toBe('About 1 kg');
  });

  it('survives damaged saved data', () => {
    expect(parseCart(null)).toEqual(EMPTY_CART);
    expect(parseCart('not json')).toEqual(EMPTY_CART);
    expect(parseCart('{"items":"x"}')).toEqual(EMPTY_CART);
    expect(parseCart('{"items":[{"productId":-1,"qty":5}],"fulfilment":"drone"}')).toEqual(EMPTY_CART);
  });

  it('reads good saved data', () => {
    const c = { items: [{ productId: 3, qty: 2000 }], fulfilment: 'pickup', areaId: null };
    expect(parseCart(JSON.stringify(c))).toEqual(c);
  });
});
