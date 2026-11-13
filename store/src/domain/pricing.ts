import { computeInvoice, type LineInput, type LineResult } from '../../../src/core/vat';
import { DomainError } from './errors.ts';

// The one place an order total and delivery fee are worked out. The browser only draws the result.
// VAT comes from the POS's own computeInvoice, so an online total equals the sale the POS will later record.

export type Fulfilment = 'delivery' | 'pickup';
export type FreeDeliveryBasis = 'after_discount_before_vat' | 'after_discount_incl_vat';

export interface QuoteLine {
  priceIncl: number;
  qty: number;
  discount: number;
  vatRateBp: number;
}

export interface DeliveryRule {
  /** Null until the client sets a fee. It is never treated as free. */
  feeIncl: number | null;
  vatBp: number;
  thresholdHalalas: number;
  basis: FreeDeliveryBasis;
}

export interface QuoteInput {
  lines: readonly QuoteLine[];
  fulfilment: Fulfilment;
  rule: DeliveryRule;
  /** A delivery area's own fee, when it has one. */
  areaFeeIncl?: number | null;
}

export interface Quote {
  lines: LineResult[];
  itemsIncl: number;
  discountTotal: number;
  eligibleSubtotal: number;
  threshold: number;
  freeDelivery: boolean;
  /** What must be added to qualify. Zero when free, or on pickup. */
  remainingForFree: number;
  deliveryFeeIncl: number;
  totalIncl: number;
  totalVat: number;
}

const toInput = (l: QuoteLine): LineInput => ({ unitPriceIncl: l.priceIncl, qty: l.qty, discount: l.discount, vatRate: l.vatRateBp });

export function quote(input: QuoteInput): Quote {
  const { lines, fulfilment, rule } = input;
  const items = lines.length > 0 ? computeInvoice(lines.map(toInput)) : { lines: [], totalIncl: 0, totalVat: 0, totalExcl: 0, totalDiscount: 0 };
  const eligibleSubtotal = rule.basis === 'after_discount_before_vat' ? items.totalExcl : items.totalIncl;

  const isDelivery = fulfilment === 'delivery';
  // Strictly greater: exactly SAR 50.00 does not qualify.
  const freeDelivery = isDelivery && eligibleSubtotal > rule.thresholdHalalas;
  const remainingForFree = isDelivery && !freeDelivery ? rule.thresholdHalalas + 1 - eligibleSubtotal : 0;

  let deliveryFeeIncl = 0;
  if (isDelivery && !freeDelivery) {
    const fee = input.areaFeeIncl ?? rule.feeIncl;
    if (fee === null) throw new DomainError('DELIVERY_FEE_NOT_SET', 'DELIVERY_FEE_NOT_SET: no delivery fee has been set');
    deliveryFeeIncl = fee;
  }

  // The fee is one more line on the same invoice, so VAT rounds per rate exactly as the POS sale will.
  const all = deliveryFeeIncl > 0 ? computeInvoice([...lines.map(toInput), { unitPriceIncl: deliveryFeeIncl, qty: 1000, discount: 0, vatRate: rule.vatBp }]) : items;

  return {
    lines: items.lines,
    itemsIncl: items.totalIncl,
    discountTotal: items.totalDiscount,
    eligibleSubtotal,
    threshold: rule.thresholdHalalas,
    freeDelivery,
    remainingForFree,
    deliveryFeeIncl,
    totalIncl: all.totalIncl,
    totalVat: all.totalVat,
  };
}
