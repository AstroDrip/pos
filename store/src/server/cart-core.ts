import { z } from 'zod';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { DomainError } from '../domain/errors.ts';
import { quote, type DeliveryRule, type Fulfilment, type QuoteLine } from '../domain/pricing.ts';
import { availabilityOf, imageUrl, SHOP_SELECT, unitLabel, stockIsFresh, type Availability, type ProductRow } from './catalog-core.ts';
import { ApiError } from './errors.ts';
import { getSettings } from './settings-core.ts';

// Turns a shopper's ids and quantities into real prices. Nothing about money is accepted from the browser.

export const cartBody = z.strictObject({
  fulfilment: z.enum(['delivery', 'pickup']),
  areaId: z.uuid().optional(),
  lines: z.array(z.strictObject({ productId: z.number().int().positive(), qty: z.number().int().positive().max(1_000_000) })).max(100),
});
export type CartBody = z.infer<typeof cartBody>;

export interface CartLineView {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  sellMode: 'unit' | 'weight';
  imageUrl: string | null;
  unitPriceIncl: number;
  qty: number;
  lineIncl: number;
  lineVat: number;
  vatRateBp: number;
  isEstimate: boolean;
  availability: Availability;
  issue: null | 'unavailable' | 'short';
}

export interface CartQuote {
  fulfilment: Fulfilment;
  lines: CartLineView[];
  itemsIncl: number;
  discountTotal: number;
  eligibleSubtotal: number;
  threshold: number;
  thresholdBeforeVat: boolean;
  freeDelivery: boolean;
  remainingForFree: number;
  deliveryFeeIncl: number;
  standardFeeIncl: number | null;
  totalIncl: number;
  totalVat: number;
  deliveryUnavailable: boolean;
  stockFresh: boolean;
  canCheckout: boolean;
}

const GONE = (productId: number, qty: number): CartLineView => ({ productId, sku: '', name: 'This item is no longer available', unit: '', lineVat: 0, vatRateBp: 0, sellMode: 'unit', imageUrl: null, unitPriceIncl: 0, qty, lineIncl: 0, isEstimate: false, availability: { state: 'out', available: 0 }, issue: 'unavailable' });

export async function quoteCart(db: Db, raw: CartBody): Promise<CartQuote> {
  const parsed = cartBody.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'That cart is not valid.');
  const body = parsed.data;
  if (new Set(body.lines.map((l) => l.productId)).size !== body.lines.length) throw new ApiError(400, 'INVALID', 'That cart is not valid.');

  const [rows, fresh, settings] = await Promise.all([
    body.lines.length ? db.query<ProductRow>(`${SHOP_SELECT} AND p.pos_product_id = ANY($1::bigint[])`, [body.lines.map((l) => l.productId)]) : Promise.resolve([]),
    stockIsFresh(db),
    getSettings(db),
  ]);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  let areaFeeIncl: number | null = null;
  if (body.fulfilment === 'delivery' && body.areaId) {
    const [area] = await db.query<{ fee_incl: number | null }>('SELECT fee_incl FROM commerce.delivery_areas WHERE id = $1 AND active', [body.areaId]);
    if (!area) throw new ApiError(400, 'BAD_AREA', 'We do not deliver to that area.');
    areaFeeIncl = area.fee_incl;
  }

  const views: CartLineView[] = [];
  const priced: QuoteLine[] = [];
  const pricedAt: number[] = [];
  for (const line of body.lines) {
    const r = byId.get(line.productId);
    if (!r) {
      views.push(GONE(line.productId, line.qty));
      continue;
    }
    if (r.sell_mode === 'unit' && line.qty % 1000 !== 0) throw new ApiError(400, 'INVALID', 'That item is sold in whole units.');
    const availability = availabilityOf(r.available, fresh);
    const issue = availability.state === 'out' ? 'unavailable' : availability.available !== null && line.qty > availability.available ? 'short' : null;
    views.push({ productId: line.productId, sku: r.sku, lineVat: 0, vatRateBp: r.vat_rate_bp, name: r.name, unit: unitLabel(r.unit), sellMode: r.sell_mode, imageUrl: imageUrl(r.object_key), unitPriceIncl: r.price_incl, qty: line.qty, lineIncl: 0, isEstimate: r.sell_mode === 'weight', availability, issue });
    if (issue !== 'unavailable') {
      pricedAt.push(views.length - 1);
      priced.push({ priceIncl: r.price_incl, qty: line.qty, discount: 0, vatRateBp: r.vat_rate_bp });
    }
  }

  const rule: DeliveryRule = { feeIncl: settings.deliveryFeeIncl, vatBp: settings.deliveryVatBp, thresholdHalalas: settings.freeDeliveryThreshold, basis: settings.freeDeliveryBasis };
  let deliveryUnavailable = false;
  let q;
  try {
    q = quote({ lines: priced, fulfilment: body.fulfilment, rule, areaFeeIncl });
  } catch (e) {
    if (!(e instanceof DomainError) || e.code !== 'DELIVERY_FEE_NOT_SET') throw e;
    deliveryUnavailable = true;
    q = quote({ lines: priced, fulfilment: 'pickup', rule });
  }
  q.lines.forEach((l, i) => {
    views[pricedAt[i]!]!.lineIncl = l.lineIncl;
    views[pricedAt[i]!]!.lineVat = l.lineVat;
  });

  return {
    fulfilment: body.fulfilment,
    lines: views,
    itemsIncl: q.itemsIncl,
    discountTotal: q.discountTotal,
    eligibleSubtotal: q.eligibleSubtotal,
    threshold: q.threshold,
    thresholdBeforeVat: settings.freeDeliveryBasis === 'after_discount_before_vat',
    freeDelivery: q.freeDelivery,
    remainingForFree: q.remainingForFree,
    deliveryFeeIncl: q.deliveryFeeIncl,
    standardFeeIncl: areaFeeIncl ?? settings.deliveryFeeIncl,
    totalIncl: q.totalIncl,
    totalVat: q.totalVat,
    deliveryUnavailable,
    stockFresh: fresh,
    canCheckout: body.lines.length > 0 && fresh && !deliveryUnavailable && views.every((v) => v.issue === null),
  };
}
