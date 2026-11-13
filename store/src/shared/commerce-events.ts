import { z } from 'zod';

// The commerce sync contract between the POS and the web. Separate from the owner dashboard's snapshots.
// Every payload is strict, so a cost field or anything unexpected is refused rather than stored.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EVENT_ID = new RegExp(`^(${UUID}):(\\d+):(\\d+)$`, 'i');

export function parseEventId(id: string): { deviceId: string; epoch: number; seq: number } | null {
  const m = EVENT_ID.exec(id);
  return m ? { deviceId: m[1]!, epoch: Number(m[2]), seq: Number(m[3]) } : null;
}

const id = z.number().int().positive();
const money = z.number().int().min(0);
const name = z.string().min(1).max(200);
const at = z.string().max(40);

const stockMovement = z.strictObject({
  movementId: id,
  productId: id,
  qty: z.number().int().refine((q) => q !== 0, 'a movement cannot be zero'),
  reason: z.enum(['sale', 'refund', 'grn', 'purchase_return', 'waste', 'count_adj', 'opening']),
  sourceType: z.string().min(1).max(40),
  sourceId: z.number().int().min(0),
  sourceLine: z.number().int().min(0),
  orderId: z.uuid().nullable(),
});

const stockCheckpoint = z.strictObject({
  uptoSeq: z.number().int().min(0),
  part: z.number().int().min(1),
  parts: z.number().int().min(1),
  balances: z.array(z.strictObject({ productId: id, qty: z.number().int() })).max(2000),
});

const catalogProduct = z.strictObject({
  productId: id,
  sku: z.string().min(1).max(60),
  nameEn: name,
  nameAr: z.string().max(200),
  categoryId: id.nullable(),
  unit: z.string().min(1).max(40),
  sellMode: z.enum(['unit', 'weight']),
  itemKind: z.enum(['stock', 'service']),
  priceIncl: money,
  vatRateBp: z.number().int().min(0).max(10_000),
  active: z.boolean(),
  barcodes: z.array(z.string().min(1).max(60)).max(50),
});

const catalogCategory = z.strictObject({ categoryId: id, nameEn: name, nameAr: z.string().max(200) });
const orderHandedOver = z.strictObject({ orderId: z.uuid(), invoiceNo: z.string().min(1).max(40), saleUuid: z.uuid(), totalIncl: money, handedOverAt: at });
const orderRefundPosted = z.strictObject({ orderId: z.uuid(), refundNo: z.string().min(1).max(40), totalIncl: money });

const envelope = {
  eventId: z.string().regex(EVENT_ID),
  version: z.number().int().min(1),
  occurredAt: at,
};

export const syncEvent = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('stock.movement'), payload: stockMovement }),
  z.strictObject({ ...envelope, type: z.literal('stock.checkpoint'), payload: stockCheckpoint }),
  z.strictObject({ ...envelope, type: z.literal('catalog.product'), payload: catalogProduct }),
  z.strictObject({ ...envelope, type: z.literal('catalog.category'), payload: catalogCategory }),
  z.strictObject({ ...envelope, type: z.literal('order.handed_over'), payload: orderHandedOver }),
  z.strictObject({ ...envelope, type: z.literal('order.refund_posted'), payload: orderRefundPosted }),
]);
export type SyncEvent = z.infer<typeof syncEvent>;

export const eventBatch = z.strictObject({ events: z.array(syncEvent).max(200), pending: z.number().int().min(0).max(100_000_000).optional() });

const orderLine = z.strictObject({ productId: id, qty: z.number().int().positive(), unitPriceIncl: money, discount: money, isEstimate: z.boolean() });

const orderAccepted = z.strictObject({
  orderId: z.uuid(),
  publicRef: z.string().min(4).max(20),
  fulfilment: z.enum(['delivery', 'pickup']),
  paymentMethod: z.enum(['card', 'mada', 'apple_pay', 'stc_pay', 'pay_at_pickup', 'cash_on_delivery']),
  customerName: z.string().min(1).max(120),
  phone: z.string().min(5).max(20),
  lines: z.array(orderLine).min(1).max(200),
  deliveryFeeIncl: money,
});

export const posCommand = z.discriminatedUnion('type', [
  z.strictObject({ id, type: z.literal('order.accepted'), payload: orderAccepted }),
  z.strictObject({ id, type: z.literal('order.cancelled'), payload: z.strictObject({ orderId: z.uuid(), reason: z.string().max(500) }) }),
  z.strictObject({ id, type: z.literal('reserved.totals'), payload: z.strictObject({ totals: z.array(z.strictObject({ productId: id, reserved: z.number().int().min(0) })).max(2000), asOf: at }) }),
  z.strictObject({ id, type: z.literal('refund.instructed'), payload: z.strictObject({ orderId: z.uuid(), refundId: z.uuid(), amount: money.positive(), reason: z.string().min(1).max(500) }) }),
  z.strictObject({ id, type: z.literal('product.request'), payload: z.strictObject({ requestId: z.uuid(), name, barcode: z.string().max(60).nullable(), note: z.string().max(500) }) }),
]);
export type PosCommand = z.infer<typeof posCommand>;
