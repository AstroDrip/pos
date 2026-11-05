import { z } from 'zod';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { requirePermission } from './users';

// A held bill is a parked cart, not a sale: no invoice number, stock or ledger effect.
// Recalling deletes the hold; prices are re-read from the catalog when the bill is finally paid.
const payloadSchema = z.object({
  lines: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().int().positive() })).min(1).max(500),
  customerId: z.number().int().positive().optional(),
  /** The bill's key, kept so a recalled bill finishes under the same key and removals stay linked to it. */
  billKey: z.string().regex(/^[\w-]{8,64}$/).optional(),
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
