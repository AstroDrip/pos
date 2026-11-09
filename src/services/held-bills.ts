import { z } from 'zod';
import { appendAudit } from './audit';
import { getProduct, type Product } from './catalog';
import { DomainError, type Ctx } from './context';
import { getCustomer, type Customer } from './parties';
import { requirePermission } from './users';

// A held bill is a parked cart, not a sale: no invoice number, stock or ledger effect.
// Recalling deletes the hold; prices are re-read from the catalog when the bill is finally paid.
// PINs and approvers are never kept: a restored discount is approved again at payment.
export const TYPED_MONEY = /^\d{0,9}(\.\d{0,2})?$/;
export const payloadSchema = z.object({
  lines: z.array(z.object({
    productId: z.number().int().positive(),
    qty: z.number().int().positive(),
    /** The unit price when held, to warn if it has changed by the time the bill comes back. */
    seenPrice: z.number().int().nonnegative().optional(),
    discount: z.number().int().nonnegative().optional(),
    scanCode: z.string().max(64).optional(),
  })).min(1).max(500),
  customerId: z.number().int().positive().optional(),
  /** The bill's key, kept so a recalled bill finishes under the same key and removals stay linked to it. */
  billKey: z.string().regex(/^[\w-]{8,64}$/).optional(),
  /** What was typed on the payment step. */
  cash: z.string().regex(TYPED_MONEY).optional(),
  card: z.string().regex(TYPED_MONEY).optional(),
});
export type HeldPayload = z.infer<typeof payloadSchema>;

export interface HeldBill {
  id: number;
  label: string;
  createdAt: string;
  lineCount: number;
}

export function holdBill(ctx: Ctx, userId: number, label: string, payload: HeldPayload): number {
  requirePermission(ctx, userId, 'sale.create');
  const p = payloadSchema.parse(payload);
  return ctx.db.transaction(() => {
    const id = Number(
      ctx.db
        .prepare('INSERT INTO held_bills (label, payload_json, user_id, created_at) VALUES (?, ?, ?, ?)')
        .run(label.trim().slice(0, 40) || 'Held bill', JSON.stringify(p), userId, ctx.now()).lastInsertRowid,
    );
    appendAudit(ctx, { userId, action: 'bill.hold', entity: 'held_bill', entityId: id, details: { lines: p.lines.length } });
    return id;
  })();
}

export function listHeldBills(ctx: Ctx): HeldBill[] {
  return (ctx.db.prepare('SELECT id, label, created_at, payload_json FROM held_bills ORDER BY id').all() as { id: number; label: string; created_at: string; payload_json: string }[]).map(
    (r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lineCount: (JSON.parse(r.payload_json) as HeldPayload).lines.length }),
  );
}

export function recallBill(ctx: Ctx, userId: number, id: number): HeldPayload {
  requirePermission(ctx, userId, 'sale.create');
  return ctx.db.transaction(() => {
    const row = ctx.db.prepare('SELECT payload_json FROM held_bills WHERE id = ?').get(id) as { payload_json: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Held bill not found (maybe already recalled)');
    ctx.db.prepare('DELETE FROM held_bills WHERE id = ?').run(id);
    appendAudit(ctx, { userId, action: 'bill.recall', entity: 'held_bill', entityId: id });
    return payloadSchema.parse(JSON.parse(row.payload_json));
  })();
}

export interface HydratedBill {
  customer: Customer | null;
  billKey?: string;
  lines: { product: Product; qty: number; discount: number; scanCode?: string; seenPrice?: number }[];
  /** Names of items no longer sold, left off the bill. */
  dropped: string[];
  cash: string;
  card: string;
}

/** A parked bill with today's product data: prices are the live ones, as for any new bill. */
export function hydrateBill(ctx: Ctx, p: HeldPayload): HydratedBill {
  const lines: HydratedBill['lines'] = [];
  const dropped: string[] = [];
  for (const l of p.lines) {
    const product = getProduct(ctx, l.productId);
    if (!product?.active) {
      if (product) dropped.push(product.nameEn);
      continue;
    }
    lines.push({ product, qty: l.qty, discount: l.discount ?? 0, ...(l.scanCode ? { scanCode: l.scanCode } : {}), ...(l.seenPrice !== undefined ? { seenPrice: l.seenPrice } : {}) });
  }
  return { customer: p.customerId ? getCustomer(ctx, p.customerId) : null, ...(p.billKey ? { billKey: p.billKey } : {}), lines, dropped, cash: p.cash ?? '', card: p.card ?? '' };
}

export function cancelHeldBill(ctx: Ctx, userId: number, id: number, reason: string): void {
  requirePermission(ctx, userId, 'sale.create');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'A reason is required');
  ctx.db.transaction(() => {
    const row = ctx.db.prepare('SELECT label FROM held_bills WHERE id = ?').get(id) as { label: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Held bill not found (maybe already recalled)');
    ctx.db.prepare('DELETE FROM held_bills WHERE id = ?').run(id);
    appendAudit(ctx, { userId, action: 'bill.cancel', entity: 'held_bill', entityId: id, details: { label: row.label, reason: reason.trim() } });
  })();
}

export type RemovalKind = 'line_removed' | 'bill_cleared';

/**
 * Records items taken off a bill before payment (a "void"). Not blocked: owner decision Q-10 (2026-11-05)
 * is no supervisor approval, but every removal is audited with the cashier and the bill it came from.
 * `billKey` is the bill's idempotency key; if the bill is later paid, the sale carries the same key,
 * so the report can show its invoice number.
 */
export function recordRemoval(ctx: Ctx, userId: number, kind: RemovalKind, billKey: string, lines: { productId: number; qty: number; amount: number }[]): void {
  requirePermission(ctx, userId, 'sale.create');
  if (!/^[\w-]{8,64}$/.test(billKey)) throw new DomainError('VALIDATION', 'Invalid bill reference');
  if (lines.length === 0) return;
  appendAudit(ctx, { userId, action: `sale.${kind}`, entity: 'bill', entityId: billKey, details: { lines, total: lines.reduce((s, l) => s + l.amount, 0) } });
}
