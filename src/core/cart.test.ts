import { describe, expect, it } from 'vitest';
import { decrementLine, incrementLine, reductionOf, restoreLine, setLineQty, type CartLine } from './cart';
import { computeInvoice } from './vat';

type P = { id: number; sellMode: 'unit' | 'weight'; priceIncl: number };
const water: P = { id: 1, sellMode: 'unit', priceIncl: 250 };
const rice: P = { id: 2, sellMode: 'unit', priceIncl: 3200 };
const lamb: P = { id: 3, sellMode: 'weight', priceIncl: 4999 };
const cart = (): CartLine<P>[] => [
  { product: water, qty: 3000, discount: 0 },
  { product: rice, qty: 1000, discount: 150 },
  { product: lamb, qty: 1250, discount: 0, scanCode: '2100003012504' },
];
const totals = (lines: CartLine<P>[]) => computeInvoice(lines.map((l) => ({ unitPriceIncl: l.product.priceIncl, qty: l.qty, discount: l.discount, vatRate: 1500 })));

describe('cart quantity', () => {
  it('+ adds one whole unit to a unit line and leaves a weighed line alone', () => {
    expect(incrementLine(cart(), 0)[0]!.qty).toBe(4000);
    expect(incrementLine(cart(), 2)[2]!.qty).toBe(1250);
  });

  it('- takes one unit off', () => {
    const r = decrementLine(cart(), 0);
    expect(r.lines[0]!.qty).toBe(2000);
    expect(r.removed).toBeNull();
  });

  it('- on the last unit removes the line and says where it was', () => {
    const r = decrementLine(cart(), 1);
    expect(r.lines.map((l) => l.product.id)).toEqual([1, 3]);
    expect(r.removed).toEqual({ line: cart()[1], index: 1 });
  });

  it('- on a weighed line changes nothing', () => {
    const r = decrementLine(cart(), 2);
    expect(r.lines).toEqual(cart());
    expect(r.removed).toBeNull();
  });

  it('typing a quantity sets whole units; 0 removes; the maximum is 9999', () => {
    expect(setLineQty(cart(), 0, 7).lines[0]!.qty).toBe(7000);
    expect(setLineQty(cart(), 0, 0).removed?.index).toBe(0);
    expect(setLineQty(cart(), 0, 10_000).lines[0]!.qty).toBe(9_999_000);
    expect(setLineQty(cart(), 2, 5).lines[2]!.qty).toBe(1250); // weighed: the label is the weight
  });

  it('undo restores discount and place, and the totals come back exactly', () => {
    const before = cart();
    const r = decrementLine(before, 1);
    expect(totals(r.lines).totalIncl).toBeLessThan(totals(before).totalIncl);
    const back = restoreLine(r.lines, r.removed!);
    expect(back).toEqual(before);
    expect(totals(back)).toEqual(totals(before));
  });

  it('undo after other lines changed puts the line at the end if its place is gone', () => {
    const r = decrementLine([{ product: rice, qty: 1000, discount: 0 }, { product: water, qty: 1000, discount: 0 }], 1);
    const fewer = decrementLine(r.lines, 0).lines; // the cart is now empty
    expect(restoreLine(fewer, r.removed!)).toEqual([{ product: water, qty: 1000, discount: 0 }]);
  });

  it('does not change the array it was given', () => {
    const c = cart();
    incrementLine(c, 0);
    decrementLine(c, 1);
    expect(c).toEqual(cart());
  });
});

describe('quantity drops are logged and never break the bill', () => {
  const big: CartLine<P> = { product: { id: 9, sellMode: 'unit', priceIncl: 1000 }, qty: 5000, discount: 500 };

  it('a lower quantity reports what left the bill and its share of the line amount', () => {
    // line amount 50.00 - 5.00 = 45.00; 3 of 5 leave -> 27.00
    expect(reductionOf(big, 2000)).toEqual({ productId: 9, qty: 3000, amount: 2700 });
    expect(reductionOf(big, 0)).toEqual({ productId: 9, qty: 5000, amount: 4500 });
  });

  it('no report when the quantity does not go down', () => {
    expect(reductionOf(big, 5000)).toBeNull();
    expect(reductionOf(big, 6000)).toBeNull();
  });

  it('refuses a drop that would leave the discount larger than the line', () => {
    const l: CartLine<P> = { product: { id: 9, sellMode: 'unit', priceIncl: 1000 }, qty: 2000, discount: 1500 };
    const r = decrementLine([l], 0);
    expect(r.blocked).toBe('discount');
    expect(r.lines).toEqual([l]);
    expect(r.removed).toBeNull();
    expect(setLineQty([l], 0, 1).blocked).toBe('discount');
    expect(setLineQty([l], 0, 0).removed?.line).toEqual(l); // removing the whole line is still allowed
  });
});

