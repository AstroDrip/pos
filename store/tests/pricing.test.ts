import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeInvoice } from '../../src/core/vat';
import { quote, type DeliveryRule, type QuoteLine } from '../src/domain/pricing.ts';

const rule: DeliveryRule = { feeIncl: 1500, vatBp: 1500, thresholdHalalas: 5000, basis: 'after_discount_before_vat' };
const line = (priceIncl: number, qty = 1000, discount = 0, vatRateBp = 1500): QuoteLine => ({ priceIncl, qty, discount, vatRateBp });
/** A single zero-VAT line, so the eligible subtotal equals the figure in the master prompt's table. */
const eligible = (halalas: number): QuoteLine[] => (halalas === 0 ? [] : [line(halalas, 1000, 0, 0)]);

describe('free delivery threshold is strictly greater than SAR 50', () => {
  it.each([
    [0, true],
    [4900, true],
    [5000, true],
    [5001, false],
    [6000, false],
  ])('eligible %i halalas: charge applies is %s', (halalas, charged) => {
    const q = quote({ lines: eligible(halalas), fulfilment: 'delivery', rule });
    expect(q.freeDelivery).toBe(!charged);
    expect(q.deliveryFeeIncl).toBe(charged ? 1500 : 0);
  });

  it('says exactly how much more is needed, one halala past the threshold', () => {
    expect(quote({ lines: eligible(3800), fulfilment: 'delivery', rule }).remainingForFree).toBe(1201);
    expect(quote({ lines: eligible(5000), fulfilment: 'delivery', rule }).remainingForFree).toBe(1);
    expect(quote({ lines: eligible(5001), fulfilment: 'delivery', rule }).remainingForFree).toBe(0);
  });

  it('never charges or offers free delivery on pickup', () => {
    const q = quote({ lines: eligible(100), fulfilment: 'pickup', rule });
    expect(q.deliveryFeeIncl).toBe(0);
    expect(q.freeDelivery).toBe(false);
    expect(q.remainingForFree).toBe(0);
  });

  it('uses the amount after discount and before VAT by default', () => {
    // Shelf SAR 57.50 at 15% is exactly SAR 50.00 before VAT, so not over the threshold.
    expect(quote({ lines: [line(5750)], fulfilment: 'delivery', rule }).eligibleSubtotal).toBe(5000);
    expect(quote({ lines: [line(5750)], fulfilment: 'delivery', rule }).freeDelivery).toBe(false);
    expect(quote({ lines: [line(5752)], fulfilment: 'delivery', rule }).freeDelivery).toBe(true);
  });

  it('a discount can drop the order back under the threshold', () => {
    expect(quote({ lines: [line(5752)], fulfilment: 'delivery', rule }).freeDelivery).toBe(true);
    expect(quote({ lines: [line(5752, 1000, 500)], fulfilment: 'delivery', rule }).freeDelivery).toBe(false);
  });

  it('can use the VAT-inclusive basis when the client chooses it', () => {
    const q = quote({ lines: [line(5001)], fulfilment: 'delivery', rule: { ...rule, basis: 'after_discount_incl_vat' } });
    expect(q.eligibleSubtotal).toBe(5001);
    expect(q.freeDelivery).toBe(true);
  });

  it('an area fee replaces the general fee', () => {
    expect(quote({ lines: eligible(100), fulfilment: 'delivery', rule, areaFeeIncl: 700 }).deliveryFeeIncl).toBe(700);
  });

  it('refuses to invent a delivery fee that was never set', () => {
    expect(() => quote({ lines: eligible(100), fulfilment: 'delivery', rule: { ...rule, feeIncl: null } })).toThrow(/DELIVERY_FEE_NOT_SET/);
  });

  it('an unset fee does not stop free or pickup orders', () => {
    expect(quote({ lines: eligible(5001), fulfilment: 'delivery', rule: { ...rule, feeIncl: null } }).freeDelivery).toBe(true);
    expect(quote({ lines: eligible(100), fulfilment: 'pickup', rule: { ...rule, feeIncl: null } }).totalIncl).toBe(100);
  });
});

describe('totals match the POS', () => {
  const sets: QuoteLine[][] = [
    [line(1150)],
    [line(333, 3000), line(999, 1000, 10)],
    [line(1199, 1537), line(2549, 873), line(100, 1000, 0, 0)],
    [line(7, 1000), line(7, 1000), line(7, 1000)],
    [line(12345, 2750, 1000), line(1, 1000, 0, 0), line(89999, 1000, 4999)],
  ];

  it.each(sets.map((s, i) => [i, s] as const))('pickup set %i equals computeInvoice', (_i, lines) => {
    const pos = computeInvoice(lines.map((l) => ({ unitPriceIncl: l.priceIncl, qty: l.qty, discount: l.discount, vatRate: l.vatRateBp })));
    const q = quote({ lines, fulfilment: 'pickup', rule });
    expect({ total: q.totalIncl, vat: q.totalVat, items: q.itemsIncl, discount: q.discountTotal, lines: q.lines }).toEqual({ total: pos.totalIncl, vat: pos.totalVat, items: pos.totalIncl, discount: pos.totalDiscount, lines: pos.lines });
  });

  it.each(sets.map((s, i) => [i, s] as const))('delivery set %i equals computeInvoice with the fee as one more line', (_i, lines) => {
    const q = quote({ lines, fulfilment: 'delivery', rule: { ...rule, thresholdHalalas: 100_000_000 } });
    const pos = computeInvoice([...lines.map((l) => ({ unitPriceIncl: l.priceIncl, qty: l.qty, discount: l.discount, vatRate: l.vatRateBp })), { unitPriceIncl: 1500, qty: 1000, discount: 0, vatRate: 1500 }]);
    expect({ total: q.totalIncl, vat: q.totalVat }).toEqual({ total: pos.totalIncl, vat: pos.totalVat });
  });

  it('an empty cart costs nothing on pickup', () => {
    expect(quote({ lines: [], fulfilment: 'pickup', rule })).toMatchObject({ totalIncl: 0, totalVat: 0, itemsIncl: 0 });
  });

  it('the store has no VAT engine of its own', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const offenders = walk(join(__dirname, '..', 'src')).filter((f) => /function\s+(computeInvoice|roundDiv)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
