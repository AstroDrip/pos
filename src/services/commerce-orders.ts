import { appendAudit } from './audit';
import { commerceEnabled } from './commerce-sync';
import { DomainError, type Ctx } from './context';
import { finalizeSale, type PaymentInput, type SaleResult } from './sales';
import { requirePermission } from './users';

// Online orders at the POS. The website sends accepted orders here. The counter hands them over as a normal
// POS sale: same invoice series, same VAT, same stock and accounts. Nothing here calculates money itself.

export interface PosCommand {
  id: number;
  type: string;
  payload: unknown;
}

interface OrderLine {
  productId: number;
  qty: number;
  unitPriceIncl: number;
  discount: number;
  isEstimate: boolean;
}

interface AcceptedPayload {
  orderId: string;
  publicRef: string;
  fulfilment: 'delivery' | 'pickup';
  paymentMethod: string;
  customerName: string;
  phone: string;
  lines: OrderLine[];
  deliveryFeeIncl: number;
}

const setCursor = (ctx: Ctx, id: number) => ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'commerce_command_cursor' AND CAST(value AS INTEGER) < ?").run(String(id), id);

export const commandCursor = (ctx: Ctx): number => Number((ctx.db.prepare("SELECT value FROM settings WHERE key = 'commerce_command_cursor'").get() as { value: string }).value);

/** Applies commands in order, each once. Unknown kinds are skipped so a newer website never stops the POS. Returns the cursor. */
export function applyCommands(ctx: Ctx, commands: PosCommand[]): number {
  for (const c of [...commands].sort((a, b) => a.id - b.id)) {
    ctx.db.transaction(() => {
      if (c.type === 'order.accepted') {
        const p = c.payload as AcceptedPayload;
        ctx.db
          .prepare(`INSERT INTO commerce_orders (order_id, public_ref, fulfilment, payment_method, customer_name, phone, delivery_fee_incl, lines_json, received_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (order_id) DO NOTHING`)
          .run(p.orderId, p.publicRef, p.fulfilment, p.paymentMethod, p.customerName, p.phone, p.deliveryFeeIncl, JSON.stringify(p.lines), ctx.now());
      } else if (c.type === 'order.cancelled') {
        const p = c.payload as { orderId: string; reason: string };
        ctx.db.prepare("UPDATE commerce_orders SET status = 'cancelled', cancel_reason = ? WHERE order_id = ? AND status = 'waiting'").run(p.reason, p.orderId);
      }
      setCursor(ctx, c.id);
    })();
  }
  return commandCursor(ctx);
}

export interface OnlineOrderView {
  orderId: string;
  publicRef: string;
  status: 'waiting' | 'handed_over' | 'cancelled';
  fulfilment: 'delivery' | 'pickup';
  paymentMethod: string;
  customerName: string;
  phone: string;
  deliveryFeeIncl: number;
  receivedAt: string;
  cancelReason: string | null;
  invoiceNo: string | null;
  saleId: number | null;
  lines: { productId: number; name: string; sellMode: 'unit' | 'weight'; qty: number; unitPriceIncl: number; priceNow: number; vatRateBp: number; isEstimate: boolean }[];
}

/** Waiting orders first, then today's handed-over and cancelled ones. */
export function onlineOrders(ctx: Ctx, userId: number): OnlineOrderView[] {
  requirePermission(ctx, userId, 'sale.create');
  const rows = ctx.db
    .prepare(`SELECT o.*, s.invoice_no FROM commerce_orders o LEFT JOIN sales s ON s.id = o.sale_id
              WHERE o.status = 'waiting' OR o.received_at >= ?
              ORDER BY o.status = 'waiting' DESC, o.received_at`)
    .all(new Date(Date.parse(ctx.now()) - 86_400_000).toISOString()) as { order_id: string; public_ref: string; status: OnlineOrderView['status']; fulfilment: OnlineOrderView['fulfilment']; payment_method: string; customer_name: string; phone: string; delivery_fee_incl: number; received_at: string; cancel_reason: string | null; invoice_no: string | null; sale_id: number | null; lines_json: string }[];
  const product = ctx.db.prepare('SELECT name_en AS name, sell_mode AS sellMode, price_incl AS priceNow, vat_rate_bp AS vatRateBp FROM products WHERE id = ?');
  return rows.map((r) => ({
    orderId: r.order_id,
    publicRef: r.public_ref,
    status: r.status,
    fulfilment: r.fulfilment,
    paymentMethod: r.payment_method,
    customerName: r.customer_name,
    phone: r.phone,
    deliveryFeeIncl: r.delivery_fee_incl,
    receivedAt: r.received_at,
    cancelReason: r.cancel_reason,
    invoiceNo: r.invoice_no,
    saleId: r.sale_id,
    lines: (JSON.parse(r.lines_json) as OrderLine[]).map((l) => {
      const p = product.get(l.productId) as { name: string; sellMode: 'unit' | 'weight'; priceNow: number; vatRateBp: number } | undefined;
      return { productId: l.productId, name: p?.name ?? `Product ${l.productId}`, sellMode: p?.sellMode ?? 'unit', qty: l.qty, unitPriceIncl: l.unitPriceIncl, priceNow: p?.priceNow ?? l.unitPriceIncl, vatRateBp: p?.vatRateBp ?? 1500, isEstimate: l.isEstimate };
    }),
  }));
}

export interface HandOverInput {
  orderId: string;
  lines: { productId: number; qty: number; scanCode?: string }[];
  payments: PaymentInput[];
  /** The cashier saw that a price changed since the order, and charges today's price. */
  useCurrentPrices?: boolean;
}

/**
 * Sells an online order through the normal sale, in one transaction with the link and the message to the website.
 * Pressing twice returns the first sale. Weighed items are sold at their real weight; any item may be fewer than ordered.
 */
export function handOverOrder(ctx: Ctx, userId: number, input: HandOverInput): SaleResult {
  return ctx.db.transaction(() => {
    const o = ctx.db.prepare('SELECT * FROM commerce_orders WHERE order_id = ?').get(input.orderId) as { status: string; fulfilment: string; delivery_fee_incl: number; lines_json: string; public_ref: string; sale_id: number | null } | undefined;
    if (!o) throw new DomainError('NOT_FOUND', 'Online order not found');
    if (o.status === 'cancelled') throw new DomainError('VALIDATION', 'This order was cancelled online. Do not hand it over.');
    if (o.fulfilment === 'delivery' && o.delivery_fee_incl > 0) throw new DomainError('VALIDATION', 'Delivery orders with a delivery fee cannot be handed over yet.');
    const ordered = new Map((JSON.parse(o.lines_json) as OrderLine[]).map((l) => [l.productId, l]));
    const lines = input.lines.filter((l) => l.qty > 0);
    if (lines.length === 0) throw new DomainError('VALIDATION', 'Choose at least one item to hand over');
    for (const l of lines) {
      const want = ordered.get(l.productId);
      if (!want) throw new DomainError('VALIDATION', 'That item is not in this order');
      if (!want.isEstimate && l.qty > want.qty) throw new DomainError('VALIDATION', 'That is more than was ordered');
    }

    const sale = finalizeSale(ctx, userId, {
      idempotencyKey: `order-${input.orderId}`,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.scanCode ? { scanCode: l.scanCode } : {}), ...(input.useCurrentPrices ? {} : { expectedUnitPrice: ordered.get(l.productId)!.unitPriceIncl }) })),
      payments: input.payments,
    });
    if (sale.replayed) return sale;
    ctx.db.prepare('INSERT INTO commerce_order_links (sale_id, order_id) VALUES (?, ?)').run(sale.saleId, input.orderId);
    ctx.db.prepare("UPDATE commerce_orders SET status = 'handed_over', sale_id = ? WHERE order_id = ?").run(sale.saleId, input.orderId);
    if (commerceEnabled(ctx)) ctx.db.prepare("INSERT INTO commerce_outbox (type, row_id) VALUES ('order.handed_over', ?)").run(sale.saleId);
    appendAudit(ctx, { userId, action: 'online.handover', entity: 'sale', entityId: sale.saleId, details: { orderId: input.orderId, ref: o.public_ref, invoiceNo: sale.invoiceNo } });
    return sale;
  })();
}
