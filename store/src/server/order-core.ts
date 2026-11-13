import { createHash, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db, Statement } from '../../../dashboard/src/server/db-types.ts';
import { checkTransition, type OrderStatus } from '../domain/order-machine.ts';
import type { PaymentStatus } from '../domain/payment-machine.ts';
import { quoteCart } from './cart-core.ts';
import { stockIsFresh, unitLabel } from './catalog-core.ts';
import { normalisePhone } from '../domain/phone.ts';
import { ApiError } from './errors.ts';
import { getSettings } from './settings-core.ts';

// Placing, showing and cancelling an order for the shopper. Every number comes from the server, and stock is held
// in the same transaction that creates the order, so an order can never exist without its stock, or the reverse.

export const PAYMENT_METHODS = ['card', 'mada', 'apple_pay', 'stc_pay', 'pay_at_pickup', 'cash_on_delivery'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods that work today. Online payment arrives with the provider in Phase C part 2. */
const BUILT: readonly PaymentMethod[] = ['pay_at_pickup'];
const FITS: Record<PaymentMethod, 'delivery' | 'pickup' | 'both'> = { card: 'both', mada: 'both', apple_pay: 'both', stc_pay: 'both', pay_at_pickup: 'pickup', cash_on_delivery: 'delivery' };

export const placeBody = z
  .strictObject({
    idempotencyKey: z.string().regex(/^[\w-]{8,64}$/),
    accessToken: z.string().regex(/^[\w-]{43,128}$/),
    fulfilment: z.enum(['delivery', 'pickup']),
    areaId: z.uuid().optional(),
    addressLine: z.string().trim().min(1).max(200).optional(),
    building: z.string().trim().max(80).optional(),
    locationNote: z.string().trim().max(300).optional(),
    customerName: z.string().trim().min(1).max(120),
    phone: z.string().max(30),
    paymentMethod: z.enum(PAYMENT_METHODS),
    lines: z.array(z.strictObject({ productId: z.number().int().positive(), qty: z.number().int().positive().max(1_000_000) })).min(1).max(100),
    expectedTotal: z.number().int().min(0),
  })
  .refine((b) => (b.fulfilment === 'delivery' ? Boolean(b.areaId && b.addressLine) : !b.areaId && !b.addressLine && !b.building), 'Address details do not match delivery or pickup');
export type PlaceOrderInput = z.input<typeof placeBody>;

const OPEN: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'];
const MAX_OPEN_PER_PHONE = 3;
const MAX_ORDERS_PER_IP_HOUR = 20;
/** Wrong private links allowed from one address in 15 minutes. Right links are never counted, so a shopper is not locked out. */
const MAX_BAD_LOOKUPS_PER_IP = 30;
const REF_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const isUnique = (e: unknown) => (e as { code?: string }).code === '23505';

export { normalisePhone };

/** The methods a shopper can pick today, for delivery or pickup. */
export function checkoutMethods(enabled: readonly string[], fulfilment: 'delivery' | 'pickup'): PaymentMethod[] {
  return BUILT.filter((m) => enabled.includes(m) && (FITS[m] === 'both' || FITS[m] === fulfilment));
}

function newRef(): string {
  const pick = () => Array.from({ length: 4 }, () => REF_LETTERS[randomInt(REF_LETTERS.length)]).join('');
  return `${pick()}-${pick()}`;
}

async function rateLimit(db: Db, key: string, max: number, minutes: number, message = 'Too many orders from here. Please try again later.') {
  const [r] = await db.query<{ n: number | string }>('SELECT count(*) AS n FROM commerce.rate_limits WHERE key = $1 AND at > now() - make_interval(mins => $2)', [key, minutes]);
  if (Number(r?.n ?? 0) >= max) throw new ApiError(429, 'RATE_LIMITED', message);
  await db.query('INSERT INTO commerce.rate_limits (key) VALUES ($1)', [key]);
}

async function replay(db: Db, key: string, hash: string): Promise<{ publicRef: string } | null> {
  const [row] = await db.query<{ request_hash: string; response: { publicRef: string } }>('SELECT request_hash, response FROM commerce.idempotency_keys WHERE key = $1', [`order:${key}`]);
  if (!row) return null;
  if (row.request_hash !== hash) throw new ApiError(409, 'KEY_REUSED', 'This request was already used for a different order.');
  return row.response;
}

export async function placeOrder(db: Db, raw: PlaceOrderInput, ip: string): Promise<{ publicRef: string }> {
  const parsed = placeBody.safeParse(raw);
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) throw new ApiError(400, 'INVALID', 'Please check your details.');
  const b = parsed.data;
  const { idempotencyKey, ...rest } = b;
  const hash = sha(JSON.stringify(rest));

  const earlier = await replay(db, idempotencyKey, hash);
  if (earlier) return earlier;

  const settings = await getSettings(db);
  const fits = FITS[b.paymentMethod];
  if (!settings.paymentMethods.includes(b.paymentMethod) || !BUILT.includes(b.paymentMethod) || (fits !== 'both' && fits !== b.fulfilment)) {
    throw new ApiError(400, 'PAYMENT_METHOD', 'That payment method is not available for this order.');
  }

  await rateLimit(db, `order:ip:${sha(ip).slice(0, 32)}`, MAX_ORDERS_PER_IP_HOUR, 60);
  const [open] = await db.query<{ n: number | string }>('SELECT count(*) AS n FROM commerce.orders WHERE phone = $1 AND status = ANY($2::text[])', [phone, OPEN]);
  if (Number(open?.n ?? 0) >= MAX_OPEN_PER_PHONE) throw new ApiError(429, 'TOO_MANY_OPEN_ORDERS', 'You already have several open orders. Please wait for them to be completed.');

  const q = await quoteCart(db, { fulfilment: b.fulfilment, ...(b.areaId ? { areaId: b.areaId } : {}), lines: b.lines });
  if (!q.stockFresh) throw new ApiError(409, 'CHECKOUT_CLOSED', 'Online ordering is paused while we update stock. Please try again soon.');
  if (q.deliveryUnavailable) throw new ApiError(409, 'DELIVERY_UNAVAILABLE', 'Delivery is not available right now. Please choose store pickup.');
  if (q.lines.some((l) => l.issue !== null)) throw new ApiError(409, 'OUT_OF_STOCK', 'Some items are no longer available in that amount. Please check your cart.');
  if (q.totalIncl !== b.expectedTotal) throw new ApiError(409, 'PRICE_CHANGED', 'A price changed since you looked. Please check the new total.');

  const orderId = randomUUID();
  const publicRef = newRef();
  const statements: Statement[] = [
    {
      text: `INSERT INTO commerce.orders (id, public_ref, access_token_hash, idempotency_key, fulfilment, customer_name, phone, area_id, address_line, building, location_note,
               items_incl, discount_total, eligible_subtotal, delivery_fee_incl, total_incl, total_vat, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now() + make_interval(mins => $18))`,
      params: [orderId, publicRef, sha(b.accessToken), idempotencyKey, b.fulfilment, b.customerName, phone, b.areaId ?? null, b.addressLine ?? null, b.building || null, b.locationNote || null,
        q.itemsIncl, q.discountTotal, q.eligibleSubtotal, q.deliveryFeeIncl, q.totalIncl, q.totalVat, settings.acceptMinutes],
    },
    ...q.lines.map((l, i) => ({
      text: `INSERT INTO commerce.order_lines (order_id, line_no, pos_product_id, sku, name, qty, unit_price_incl, discount, vat_rate_bp, line_incl, line_vat, is_estimate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)`,
      params: [orderId, i + 1, l.productId, l.sku, l.name, l.qty, l.unitPriceIncl, l.vatRateBp, l.lineIncl, l.lineVat, l.isEstimate],
    })),
    { text: "INSERT INTO commerce.order_status_history (order_id, from_status, to_status, actor) VALUES ($1, NULL, 'placed', 'customer')", params: [orderId] },
    { text: "INSERT INTO commerce.payments (order_id, method, status, amount, idempotency_key) VALUES ($1, $2, 'due_at_pickup', $3, $4)", params: [orderId, b.paymentMethod, q.totalIncl, `${orderId}:1`] },
    { text: "SELECT commerce.place_order_reserve($1, $2::jsonb, now() + make_interval(mins => $3))", params: [orderId, JSON.stringify(b.lines), settings.acceptMinutes] },
    { text: 'INSERT INTO commerce.idempotency_keys (key, request_hash, response) VALUES ($1, $2, $3)', params: [`order:${idempotencyKey}`, hash, JSON.stringify({ publicRef })] },
  ];
  try {
    await db.batch(statements);
  } catch (e) {
    if (e instanceof Error && e.message.includes('INSUFFICIENT_STOCK')) throw new ApiError(409, 'OUT_OF_STOCK', 'Some items just sold out. Please check your cart.');
    if (isUnique(e)) {
      const again = await replay(db, idempotencyKey, hash); // the same order arriving twice at once
      if (again) return again;
    }
    throw e;
  }
  return { publicRef };
}

export interface CustomerOrder {
  publicRef: string;
  status: OrderStatus;
  fulfilment: 'delivery' | 'pickup';
  createdAt: string;
  expiresAt: string | null;
  customerName: string;
  phone: string;
  areaName: string | null;
  addressLine: string | null;
  building: string | null;
  locationNote: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  itemsIncl: number;
  deliveryFeeIncl: number;
  totalIncl: number;
  totalVat: number;
  lines: { name: string; qty: number; unit: string; sellMode: 'unit' | 'weight'; unitPriceIncl: number; lineIncl: number; isEstimate: boolean }[];
  history: { status: OrderStatus; at: string }[];
  canCancel: boolean;
  rejectionReason: string | null;
}

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

async function findOwned(db: Db, ref: string, token: string, ip: string): Promise<{ id: string; status: OrderStatus; version: number; fulfilment: 'delivery' | 'pickup' } | null> {
  const o = await lookUp(db, ref, token);
  if (!o) await rateLimit(db, `lookup:ip:${sha(ip).slice(0, 32)}`, MAX_BAD_LOOKUPS_PER_IP, 15, 'Too many tries from here. Please wait a few minutes and open your order link again.');
  return o;
}

async function lookUp(db: Db, ref: string, token: string) {
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(ref) || !/^[\w-]{43,128}$/.test(token)) return null;
  const [o] = await db.query<{ id: string; status: OrderStatus; version: number; fulfilment: 'delivery' | 'pickup' }>('SELECT id, status, version, fulfilment FROM commerce.orders WHERE public_ref = $1 AND access_token_hash = $2', [ref, sha(token)]);
  return o ?? null;
}

/** Null for a wrong link and for an unknown order alike, so a guess learns nothing. */
export async function getOrderForCustomer(db: Db, ref: string, token: string, ip: string): Promise<CustomerOrder | null> {
  await expireDueOrders(db);
  const owned = await findOwned(db, ref, token, ip);
  if (!owned) return null;
  const [[o], lines, history, [pay]] = await Promise.all([
    db.query<Record<string, unknown>>(`SELECT o.public_ref, o.status, o.fulfilment, o.created_at, o.expires_at, o.customer_name, o.phone, a.name AS area_name, o.address_line, o.building, o.location_note,
        o.items_incl, o.delivery_fee_incl, o.total_incl, o.total_vat FROM commerce.orders o LEFT JOIN commerce.delivery_areas a ON a.id = o.area_id WHERE o.id = $1`, [owned.id]),
    db.query<{ name: string; qty: number; unit: string | null; sell_mode: 'unit' | 'weight' | null; unit_price_incl: number; line_incl: number; is_estimate: boolean }>(
      `SELECT l.name, l.qty, p.unit, p.sell_mode, l.unit_price_incl, l.line_incl, l.is_estimate FROM commerce.order_lines l
       LEFT JOIN commerce.catalog_products p ON p.pos_product_id = l.pos_product_id WHERE l.order_id = $1 ORDER BY l.line_no`, [owned.id]),
    db.query<{ to_status: OrderStatus; at: Date | string; reason: string | null; actor: string }>('SELECT to_status, at, reason, actor FROM commerce.order_status_history WHERE order_id = $1 ORDER BY at, id', [owned.id]),
    db.query<{ method: PaymentMethod; status: PaymentStatus }>('SELECT method, status FROM commerce.payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [owned.id]),
  ]);
  const r = o!;
  return {
    publicRef: r.public_ref as string,
    status: r.status as OrderStatus,
    fulfilment: r.fulfilment as 'delivery' | 'pickup',
    createdAt: iso(r.created_at as Date)!,
    expiresAt: iso(r.expires_at as Date | null),
    customerName: r.customer_name as string,
    phone: r.phone as string,
    areaName: (r.area_name as string | null) ?? null,
    addressLine: (r.address_line as string | null) ?? null,
    building: (r.building as string | null) ?? null,
    locationNote: (r.location_note as string | null) ?? null,
    paymentMethod: pay!.method,
    paymentStatus: pay!.status,
    itemsIncl: r.items_incl as number,
    deliveryFeeIncl: r.delivery_fee_incl as number,
    totalIncl: r.total_incl as number,
    totalVat: r.total_vat as number,
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, unit: unitLabel(l.unit ?? ''), sellMode: l.sell_mode ?? 'unit', unitPriceIncl: l.unit_price_incl, lineIncl: l.line_incl, isEstimate: l.is_estimate })),
    history: history.map((h) => ({ status: h.to_status, at: iso(h.at)! })),
    rejectionReason: history.find((h) => h.to_status === 'rejected' || (h.to_status === 'cancelled' && h.actor === 'staff'))?.reason ?? null,
    canCancel: checkTransition({ from: owned.status, to: 'cancelled', actor: 'customer', fulfilment: owned.fulfilment, permissions: new Set(), reason: null }).ok,
  };
}

/** The statements that end an order and give back what it held. Each only acts if the order really reached that status. */
function endOrder(id: string, from: OrderStatus, to: 'cancelled' | 'expired', actor: 'customer' | 'system', reason: string, extraWhere: string): Statement[] {
  return [
    {
      text: `WITH u AS (UPDATE commerce.orders SET status = $2, version = version + 1 WHERE id = $1 AND status = $3 ${extraWhere} RETURNING id)
             INSERT INTO commerce.order_status_history (order_id, from_status, to_status, actor, reason) SELECT id, $3, $2, $4, $5 FROM u`,
      params: [id, to, from, actor, reason],
    },
    { text: "UPDATE commerce.payments SET status = 'cancelled' WHERE order_id = $1 AND status IN ('pending', 'due_at_pickup', 'due_on_delivery') AND EXISTS (SELECT 1 FROM commerce.orders WHERE id = $1 AND status = $2)", params: [id, to] },
    { text: 'SELECT commerce.release_reservation(id, $2) FROM commerce.orders WHERE id = $1 AND status = $3', params: [id, reason, to] },
  ];
}

export async function cancelByCustomer(db: Db, ref: string, token: string, ip: string): Promise<void> {
  const o = await findOwned(db, ref, token, ip);
  if (!o) throw new ApiError(404, 'NOT_FOUND', 'We could not find that order.');
  const cannot = new ApiError(409, 'CANNOT_CANCEL', 'This order can no longer be cancelled online. Please contact the store.');
  if (!checkTransition({ from: o.status, to: 'cancelled', actor: 'customer', fulfilment: o.fulfilment, permissions: new Set(), reason: null }).ok) throw cannot;
  await db.batch(endOrder(o.id, o.status, 'cancelled', 'customer', 'Cancelled by customer', `AND version = ${Number(o.version)}`));
  const [now] = await db.query<{ status: OrderStatus }>('SELECT status FROM commerce.orders WHERE id = $1', [o.id]);
  if (now?.status !== 'cancelled') throw cannot; // the store acted first
}

/**
 * Orders the store did not accept in time end, and give their stock back. Run whenever orders are read or placed.
 * While the POS is quiet the clock stops, because staff cannot safely accept then.
 */
export async function expireDueOrders(db: Db): Promise<number> {
  if (!(await stockIsFresh(db))) return 0;
  const due = await db.query<{ id: string }>("SELECT id FROM commerce.orders WHERE status = 'placed' AND expires_at < now() ORDER BY expires_at LIMIT 50");
  let ended = 0;
  for (const { id } of due) {
    await db.batch(endOrder(id, 'placed', 'expired', 'system', 'Not accepted in time', 'AND expires_at < now()'));
    const [o] = await db.query<{ status: string }>('SELECT status FROM commerce.orders WHERE id = $1', [id]);
    if (o?.status === 'expired') ended++;
  }
  return ended;
}
