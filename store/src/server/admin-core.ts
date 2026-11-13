import { z } from 'zod';
import type { Db, Statement } from '../../../dashboard/src/server/db-types.ts';
import { checkTransition, nextStatuses, ORDER_STATUSES, type OrderStatus } from '../domain/order-machine.ts';
import { PAYMENT_STATUSES, type PaymentStatus } from '../domain/payment-machine.ts';
import { requirePermission, type StaffUser } from './auth-core.ts';
import { stockIsFresh, unitLabel } from './catalog-core.ts';
import { ApiError } from './errors.ts';
import { expireDueOrders } from './order-core.ts';

// The staff side of online orders and website products. Every function checks the permission itself,
// so a hidden button is never the only guard.

export interface OrderRow {
  id: string;
  publicRef: string;
  createdAt: string;
  customerName: string;
  phone: string;
  fulfilment: 'delivery' | 'pickup';
  location: string;
  itemCount: number;
  totalIncl: number;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  assignedStaff: string | null;
}

export const orderQuery = z.strictObject({
  status: z.enum(ORDER_STATUSES).optional(),
  fulfilment: z.enum(['delivery', 'pickup']).optional(),
  payment: z.enum(PAYMENT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type OrderQuery = z.input<typeof orderQuery>;

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export async function listOrders(db: Db, user: StaffUser, raw: OrderQuery): Promise<{ items: OrderRow[]; total: number }> {
  requirePermission(user, 'orders.view');
  const parsed = orderQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'Those filters are not valid.');
  const f = parsed.data;
  await expireDueOrders(db);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT o.id, o.public_ref, o.created_at, o.customer_name, o.phone, o.fulfilment, a.name AS area_name, o.address_line, o.total_incl, o.status,
            s.display_name AS assigned, (SELECT count(*) FROM commerce.order_lines l WHERE l.order_id = o.id) AS item_count,
            (SELECT p.status FROM commerce.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
            count(*) OVER () AS total
     FROM commerce.orders o
     LEFT JOIN commerce.delivery_areas a ON a.id = o.area_id
     LEFT JOIN commerce.staff_users s ON s.id = o.assigned_staff
     WHERE ($1::text IS NULL OR o.status = $1)
       AND ($2::text IS NULL OR o.fulfilment = $2)
       AND ($3::text IS NULL OR (SELECT p.status FROM commerce.payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) = $3)
       AND ($4::text IS NULL OR o.public_ref ILIKE $4 OR o.customer_name ILIKE $4 OR o.phone ILIKE $4)
       AND ($5::date IS NULL OR o.created_at >= $5::date)
       AND ($6::date IS NULL OR o.created_at < $6::date + 1)
     ORDER BY o.created_at DESC
     LIMIT $7 OFFSET $8`,
    [f.status ?? null, f.fulfilment ?? null, f.payment ?? null, f.q ? like(f.q) : null, f.from ?? null, f.to ?? null, f.limit, f.offset],
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: r.id as string,
      publicRef: r.public_ref as string,
      createdAt: iso(r.created_at)!,
      customerName: r.customer_name as string,
      phone: r.phone as string,
      fulfilment: r.fulfilment as 'delivery' | 'pickup',
      location: r.fulfilment === 'pickup' ? 'Store pickup' : [r.area_name, r.address_line].filter(Boolean).join(', '),
      itemCount: Number(r.item_count),
      totalIncl: r.total_incl as number,
      paymentStatus: r.payment_status as PaymentStatus,
      status: r.status as OrderStatus,
      assignedStaff: (r.assigned as string | null) ?? null,
    })),
  };
}

export interface StaffOrderLine {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  sellMode: 'unit' | 'weight';
  qty: number;
  unitPriceIncl: number;
  priceNow: number | null;
  lineIncl: number;
  lineVat: number;
  isEstimate: boolean;
  imageUrl: string | null;
  onHand: number | null;
  reserved: number | null;
  available: number | null;
  stockNote: string;
}

export interface StaffOrder {
  id: string;
  publicRef: string;
  status: OrderStatus;
  version: number;
  fulfilment: 'delivery' | 'pickup';
  createdAt: string;
  expiresAt: string | null;
  customerName: string;
  phone: string;
  areaName: string | null;
  addressLine: string | null;
  building: string | null;
  locationNote: string | null;
  lines: StaffOrderLine[];
  itemsIncl: number;
  deliveryFeeIncl: number;
  totalIncl: number;
  totalVat: number;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  posInvoiceNo: string | null;
  history: { status: OrderStatus; from: OrderStatus | null; at: string; actor: string; staff: string | null; reason: string | null }[];
  actions: OrderStatus[];
}

const units = (milli: number) => (milli % 1000 === 0 ? String(milli / 1000) : (milli / 1000).toFixed(3).replace(/0+$/, ''));

export async function getOrderForStaff(db: Db, user: StaffUser, id: string): Promise<StaffOrder> {
  requirePermission(user, 'orders.view');
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'NOT_FOUND', 'Order not found.');
  await expireDueOrders(db);
  const [[o], lines, history, [pay]] = await Promise.all([
    db.query<Record<string, unknown>>(`SELECT o.*, a.name AS area_name FROM commerce.orders o LEFT JOIN commerce.delivery_areas a ON a.id = o.area_id WHERE o.id = $1`, [id]),
    db.query<Record<string, unknown>>(
      `SELECT l.pos_product_id, l.sku, l.name, l.qty, l.unit_price_incl, l.line_incl, l.line_vat, l.is_estimate, p.unit, p.sell_mode, p.price_incl AS price_now,
              i.on_hand, i.reserved, a.available, (SELECT object_key FROM commerce.product_images im WHERE im.pos_product_id = l.pos_product_id AND im.is_primary) AS object_key
       FROM commerce.order_lines l
       LEFT JOIN commerce.catalog_products p ON p.pos_product_id = l.pos_product_id
       LEFT JOIN commerce.inventory_positions i ON i.pos_product_id = l.pos_product_id
       LEFT JOIN commerce.product_availability a ON a.pos_product_id = l.pos_product_id
       WHERE l.order_id = $1 ORDER BY l.line_no`,
      [id],
    ),
    db.query<Record<string, unknown>>(`SELECT h.to_status, h.from_status, h.at, h.actor, h.reason, s.display_name FROM commerce.order_status_history h LEFT JOIN commerce.staff_users s ON s.id = h.staff_id WHERE h.order_id = $1 ORDER BY h.at, h.id`, [id]),
    db.query<{ method: string; status: PaymentStatus; amount_captured: number }>('SELECT method, status, amount_captured FROM commerce.payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [id]),
  ]);
  if (!o) throw new ApiError(404, 'NOT_FOUND', 'Order not found.');
  const { imageUrl } = await import('./catalog-core.ts');
  const status = o.status as OrderStatus;
  const fulfilment = o.fulfilment as 'delivery' | 'pickup';
  return {
    id,
    publicRef: o.public_ref as string,
    status,
    version: Number(o.version),
    fulfilment,
    createdAt: iso(o.created_at)!,
    expiresAt: iso(o.expires_at),
    customerName: o.customer_name as string,
    phone: o.phone as string,
    areaName: (o.area_name as string | null) ?? null,
    addressLine: (o.address_line as string | null) ?? null,
    building: (o.building as string | null) ?? null,
    locationNote: (o.location_note as string | null) ?? null,
    lines: lines.map((l) => {
      const onHand = l.on_hand === null ? null : Number(l.on_hand);
      const reserved = l.reserved === null ? null : Number(l.reserved);
      const short = onHand !== null && reserved !== null ? reserved - onHand : 0;
      return {
        productId: Number(l.pos_product_id),
        sku: l.sku as string,
        name: l.name as string,
        unit: unitLabel((l.unit as string | null) ?? ''),
        sellMode: ((l.sell_mode as string | null) ?? 'unit') === 'weight' ? 'weight' : 'unit',
        qty: l.qty as number,
        unitPriceIncl: l.unit_price_incl as number,
        priceNow: (l.price_now as number | null) ?? null,
        lineIncl: l.line_incl as number,
        lineVat: l.line_vat as number,
        isEstimate: l.is_estimate as boolean,
        imageUrl: imageUrl((l.object_key as string | null) ?? null),
        onHand,
        reserved,
        available: (l.available as number | null) ?? null,
        stockNote: onHand === null ? 'Not reported by the POS' : short > 0 ? `Short by ${units(short)}` : 'In stock',
      };
    }),
    itemsIncl: o.items_incl as number,
    deliveryFeeIncl: o.delivery_fee_incl as number,
    totalIncl: o.total_incl as number,
    totalVat: o.total_vat as number,
    paymentMethod: pay?.method ?? 'unknown',
    paymentStatus: pay?.status ?? 'pending',
    amountPaid: pay?.amount_captured ?? 0,
    posInvoiceNo: (o.pos_invoice_no as string | null) ?? null,
    history: history.map((h) => ({ status: h.to_status as OrderStatus, from: (h.from_status as OrderStatus | null) ?? null, at: iso(h.at)!, actor: h.actor as string, staff: (h.display_name as string | null) ?? null, reason: (h.reason as string | null) ?? null })),
    actions: nextStatuses(status, fulfilment).filter((to) => checkTransition({ from: status, to, actor: 'staff', fulfilment, permissions: user.permissions, reason: 'x' }).ok),
  };
}

export interface AcceptProblem {
  sku: string | null;
  name: string | null;
  problem: string;
}

async function acceptProblems(db: Db, orderId: string): Promise<AcceptProblem[]> {
  if (!(await stockIsFresh(db))) return [{ sku: null, name: null, problem: 'The POS has not been heard from recently, so stock cannot be confirmed.' }];
  const rows = await db.query<Record<string, unknown>>(
    `SELECT l.sku, l.name, l.qty, w.status AS web_status, p.pos_active, i.on_hand, i.reserved, r.qty AS held, r.state
     FROM commerce.order_lines l
     LEFT JOIN commerce.catalog_products p ON p.pos_product_id = l.pos_product_id
     LEFT JOIN commerce.web_products w ON w.pos_product_id = l.pos_product_id
     LEFT JOIN commerce.inventory_positions i ON i.pos_product_id = l.pos_product_id
     LEFT JOIN commerce.reservations r ON r.order_id = l.order_id AND r.pos_product_id = l.pos_product_id
     WHERE l.order_id = $1 ORDER BY l.line_no`,
    [orderId],
  );
  const out: AcceptProblem[] = [];
  for (const r of rows) {
    const at = { sku: r.sku as string, name: r.name as string };
    if (r.web_status !== 'published' || r.pos_active !== true) out.push({ ...at, problem: 'No longer published online.' });
    else if (r.state !== 'active' || Number(r.held) !== Number(r.qty)) out.push({ ...at, problem: 'Its stock is no longer held for this order.' });
    else if (Number(r.on_hand) < Number(r.reserved)) out.push({ ...at, problem: `Short by ${units(Number(r.reserved) - Number(r.on_hand))}. On hand ${units(Number(r.on_hand))}, held for online orders ${units(Number(r.reserved))}.` });
  }
  return out;
}

export const changeBody = z.strictObject({
  orderId: z.uuid(),
  to: z.enum(ORDER_STATUSES),
  version: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

/** Moves an order on, only along the approved paths, and only if nobody else moved it first. */
export async function changeOrderStatus(db: Db, user: StaffUser, raw: z.input<typeof changeBody>): Promise<void> {
  const parsed = changeBody.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'That change is not valid.');
  const { orderId, to, version, reason } = parsed.data;
  const [o] = await db.query<{ status: OrderStatus; fulfilment: 'delivery' | 'pickup'; version: number; public_ref: string }>('SELECT status, fulfilment, version, public_ref FROM commerce.orders WHERE id = $1', [orderId]);
  if (!o) throw new ApiError(404, 'NOT_FOUND', 'Order not found.');
  if (o.version !== version) throw new ApiError(409, 'CHANGED', 'Someone else changed this order. It has been reloaded.');
  const check = checkTransition({ from: o.status, to, actor: 'staff', fulfilment: o.fulfilment, permissions: user.permissions, reason: reason ?? null });
  if (!check.ok) {
    if (check.code === 'FORBIDDEN') throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.');
    if (check.code === 'REASON_REQUIRED') throw new ApiError(400, 'REASON_REQUIRED', 'Please give a reason.');
    throw new ApiError(409, 'BAD_TRANSITION', 'That step is not possible for this order now.');
  }
  if (to === 'accepted') {
    const problems = await acceptProblems(db, orderId);
    if (problems.length) throw new ApiError(409, 'CANNOT_ACCEPT', 'This order cannot be accepted yet.', problems);
  }

  const statements: Statement[] = [
    {
      text: `WITH u AS (UPDATE commerce.orders SET status = $2::text, version = version + 1, assigned_staff = COALESCE(assigned_staff, $5::bigint), expires_at = CASE WHEN $2::text = 'accepted' THEN NULL ELSE expires_at END
                    WHERE id = $1::uuid AND status = $3::text AND version = $4::integer RETURNING id)
             INSERT INTO commerce.order_status_history (order_id, from_status, to_status, staff_id, actor, reason) SELECT id, $3::text, $2::text, $5::bigint, 'staff', $6::text FROM u`,
      params: [orderId, to, o.status, version, user.userId, reason || null],
    },
  ];
  if (to === 'accepted') {
    statements.push({
      text: `INSERT INTO commerce.pos_commands (type, payload)
             SELECT 'order.accepted', commerce.order_accepted_payload(o.id) FROM commerce.orders o
             WHERE o.id = $1 AND o.status = 'accepted' AND o.version = $2`,
      params: [orderId, version + 1],
    });
  }
  if (to === 'rejected' || to === 'cancelled') {
    statements.push(
      { text: "UPDATE commerce.payments SET status = 'cancelled' WHERE order_id = $1 AND status IN ('pending', 'due_at_pickup', 'due_on_delivery') AND EXISTS (SELECT 1 FROM commerce.orders WHERE id = $1::uuid AND status = $2::text AND version = $3::integer)", params: [orderId, to, version + 1] },
      { text: 'SELECT commerce.release_reservation(id, $2::text) FROM commerce.orders WHERE id = $1::uuid AND status = $3::text AND version = $4::integer', params: [orderId, reason ?? to, to, version + 1] },
    );
    if (o.status !== 'placed') {
      statements.push({ text: "INSERT INTO commerce.pos_commands (type, payload) SELECT 'order.cancelled', jsonb_build_object('orderId', id, 'reason', $2::text) FROM commerce.orders WHERE id = $1::uuid AND status = $3::text AND version = $4::integer", params: [orderId, reason ?? '', to, version + 1] });
    }
  }
  statements.push({ text: "INSERT INTO commerce.audit_log (actor, actor_id, action, entity, entity_id, detail) SELECT 'staff', $1::text, 'order.' || $3::text, 'order', $2::text, $4::jsonb FROM commerce.orders WHERE id = $2::uuid AND status = $3::text", params: [String(user.userId), orderId, to, JSON.stringify({ from: o.status, reason: reason ?? null, ref: o.public_ref })] });
  await db.batch(statements);
  const [now] = await db.query<{ status: OrderStatus; version: number }>('SELECT status, version FROM commerce.orders WHERE id = $1', [orderId]);
  if (now?.status !== to || now.version !== version + 1) throw new ApiError(409, 'CHANGED', 'Someone else changed this order. It has been reloaded.');
}

export async function adminSummary(db: Db, user: StaffUser): Promise<{ counts: Partial<Record<OrderStatus, number>>; paymentProblems: number; openDiscrepancies: number; sync: { fresh: boolean; lastSeenAt: string | null; parked: number } }> {
  requirePermission(user, 'orders.view');
  await expireDueOrders(db);
  const [counts, [pay], [disc], [seen], [parked], fresh] = await Promise.all([
    db.query<{ status: OrderStatus; n: number | string }>("SELECT status, count(*) AS n FROM commerce.orders WHERE status IN ('placed','accepted','preparing','ready_for_pickup','out_for_delivery') OR created_at > now() - interval '1 day' GROUP BY status"),
    db.query<{ n: number | string }>("SELECT count(*) AS n FROM commerce.payments WHERE status = 'failed' AND created_at > now() - interval '7 days'"),
    db.query<{ n: number | string }>("SELECT count(*) AS n FROM commerce.stock_discrepancies WHERE state = 'open'"),
    db.query<{ at: Date | null }>("SELECT max(last_seen_at) AS at FROM commerce.devices WHERE status = 'active'"),
    db.query<{ n: number | string }>("SELECT count(*) AS n FROM commerce.sync_inbox WHERE status = 'parked'"),
    stockIsFresh(db),
  ]);
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    paymentProblems: Number(pay?.n ?? 0),
    openDiscrepancies: Number(disc?.n ?? 0),
    sync: { fresh, lastSeenAt: iso(seen?.at ?? null), parked: Number(parked?.n ?? 0) },
  };
}

export interface StaffProduct {
  id: number;
  sku: string;
  name: string;
  categoryName: string | null;
  priceIncl: number;
  unit: string;
  posActive: boolean;
  status: 'unpublished' | 'published' | 'archived';
  description: string;
  featured: boolean;
  safetyStock: number;
  onHand: number | null;
  reserved: number | null;
  available: number | null;
  imageUrl: string | null;
  updatedAt: string;
}

export const productQuery = z.strictObject({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['unpublished', 'published', 'archived']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listProductsForStaff(db: Db, user: StaffUser, raw: z.input<typeof productQuery>): Promise<{ items: StaffProduct[]; total: number }> {
  requirePermission(user, 'products.edit');
  const parsed = productQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'Those filters are not valid.');
  const f = parsed.data;
  const { imageUrl } = await import('./catalog-core.ts');
  const rows = await db.query<Record<string, unknown>>(
    `SELECT p.pos_product_id, p.sku, p.name_en, c.name_en AS category_name, p.price_incl, p.unit, p.pos_active, w.status, w.description, w.featured, w.safety_stock,
            i.on_hand, i.reserved, a.available, w.updated_at, im.object_key, count(*) OVER () AS total
     FROM commerce.catalog_products p
     JOIN commerce.web_products w ON w.pos_product_id = p.pos_product_id
     LEFT JOIN commerce.catalog_categories c ON c.pos_category_id = p.category_id
     LEFT JOIN commerce.inventory_positions i ON i.pos_product_id = p.pos_product_id
     LEFT JOIN commerce.product_availability a ON a.pos_product_id = p.pos_product_id
     LEFT JOIN commerce.product_images im ON im.pos_product_id = p.pos_product_id AND im.is_primary
     WHERE p.item_kind = 'stock' AND ($1::text IS NULL OR w.status = $1) AND ($2::text IS NULL OR p.name_en ILIKE $2 OR p.sku ILIKE $2)
     ORDER BY p.name_en LIMIT $3 OFFSET $4`,
    [f.status ?? null, f.q ? like(f.q) : null, f.limit, f.offset],
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: Number(r.pos_product_id),
      sku: r.sku as string,
      name: r.name_en as string,
      categoryName: (r.category_name as string | null) ?? null,
      priceIncl: r.price_incl as number,
      unit: unitLabel(r.unit as string),
      posActive: r.pos_active as boolean,
      status: r.status as StaffProduct['status'],
      description: r.description as string,
      featured: r.featured as boolean,
      safetyStock: r.safety_stock as number,
      onHand: r.on_hand === null ? null : Number(r.on_hand),
      reserved: r.reserved === null ? null : Number(r.reserved),
      available: r.available === null ? null : Number(r.available),
      imageUrl: imageUrl((r.object_key as string | null) ?? null),
      updatedAt: iso(r.updated_at)!,
    })),
  };
}

export const productWebPatch = z.strictObject({
  description: z.string().trim().max(2000).optional(),
  featured: z.boolean().optional(),
  safetyStock: z.number().int().min(0).max(10_000_000).optional(),
});

/** Only the website's own fields. Name, price and VAT stay with the POS. */
export async function updateProductWeb(db: Db, user: StaffUser, productId: number, raw: z.input<typeof productWebPatch>): Promise<void> {
  requirePermission(user, 'products.edit');
  const parsed = productWebPatch.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'Those details are not valid.');
  const p = parsed.data;
  await db.batch([
    { text: 'UPDATE commerce.web_products SET description = COALESCE($2, description), featured = COALESCE($3, featured), safety_stock = COALESCE($4::integer, safety_stock), updated_by = $5, updated_at = now() WHERE pos_product_id = $1', params: [productId, p.description ?? null, p.featured ?? null, p.safetyStock ?? null, user.userId] },
    { text: "INSERT INTO commerce.audit_log (actor, actor_id, action, entity, entity_id, detail) VALUES ('staff', $1, 'product.web', 'product', $2, $3)", params: [String(user.userId), String(productId), JSON.stringify(p)] },
  ]);
}

export async function setProductStatus(db: Db, user: StaffUser, productId: number, status: StaffProduct['status']): Promise<void> {
  requirePermission(user, 'products.publish');
  if (!['unpublished', 'published', 'archived'].includes(status)) throw new ApiError(400, 'INVALID', 'Unknown status.');
  await db.batch([
    { text: 'UPDATE commerce.web_products SET status = $2, updated_by = $3, updated_at = now() WHERE pos_product_id = $1', params: [productId, status, user.userId] },
    { text: "INSERT INTO commerce.audit_log (actor, actor_id, action, entity, entity_id, detail) VALUES ('staff', $1, 'product.status', 'product', $2, $3)", params: [String(user.userId), String(productId), JSON.stringify({ status })] },
  ]);
}

export interface SyncHealth {
  devices: { name: string; status: string; lastContactAt: string | null; lastSeenAt: string | null; epoch: number; ackedSeq: number; needsCheckpoint: boolean }[];
  parked: { eventId: string; type: string; error: string | null; receivedAt: string }[];
  discrepancies: { id: string; kind: 'checkpoint' | 'shortage' | 'reservation_sum'; productId: number; name: string | null; sku: string | null; expected: number; actual: number; createdAt: string }[];
}

/** What staff need to see when stock and the POS disagree, or the POS has gone quiet. */
export async function syncHealth(db: Db, user: StaffUser): Promise<SyncHealth> {
  requirePermission(user, 'stock.view');
  const [devices, parked, disc] = await Promise.all([
    db.query<Record<string, unknown>>('SELECT name, status, last_contact_at, last_seen_at, epoch, acked_seq, needs_checkpoint FROM commerce.devices ORDER BY created_at'),
    db.query<Record<string, unknown>>("SELECT event_id, type, error, received_at FROM commerce.sync_inbox WHERE status = 'parked' ORDER BY received_at DESC LIMIT 50"),
    db.query<Record<string, unknown>>(`SELECT d.id, d.kind, d.pos_product_id, p.name_en, p.sku, d.expected, d.actual, d.created_at
      FROM commerce.stock_discrepancies d LEFT JOIN commerce.catalog_products p ON p.pos_product_id = d.pos_product_id
      WHERE d.state = 'open' ORDER BY d.created_at DESC LIMIT 200`),
  ]);
  return {
    devices: devices.map((d) => ({ name: d.name as string, status: d.status as string, lastContactAt: iso(d.last_contact_at), lastSeenAt: iso(d.last_seen_at), epoch: Number(d.epoch), ackedSeq: Number(d.acked_seq), needsCheckpoint: d.needs_checkpoint as boolean })),
    parked: parked.map((p) => ({ eventId: p.event_id as string, type: p.type as string, error: (p.error as string | null) ?? null, receivedAt: iso(p.received_at)! })),
    discrepancies: disc.map((d) => ({ id: d.id as string, kind: d.kind as SyncHealth['discrepancies'][number]['kind'], productId: Number(d.pos_product_id), name: (d.name_en as string | null) ?? null, sku: (d.sku as string | null) ?? null, expected: d.expected as number, actual: d.actual as number, createdAt: iso(d.created_at)! })),
  };
}

/** A person checked a difference and dealt with it. The record stays, marked resolved. */
export async function resolveDiscrepancy(db: Db, user: StaffUser, id: string): Promise<void> {
  requirePermission(user, 'stock.override');
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  await db.batch([
    { text: "UPDATE commerce.stock_discrepancies SET state = 'resolved', resolved_by = $2 WHERE id = $1 AND state = 'open'", params: [id, user.userId] },
    { text: "INSERT INTO commerce.audit_log (actor, actor_id, action, entity, entity_id) VALUES ('staff', $1, 'stock.resolve', 'stock_discrepancy', $2)", params: [String(user.userId), id] },
  ]);
}
