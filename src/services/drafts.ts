import { isSupplierDraft } from '../core/bill-draft';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { payloadSchema } from './held-bills';
import { requirePermission } from './users';

// Keeps what was on screen if the app stops. A draft is not a sale: PINs and approvers are never in it.

export type DraftKind = 'sale' | 'supplier_bill';
const NEEDS: Record<DraftKind, string> = { sale: 'sale.create', supplier_bill: 'purchase.manage' };
const MAX_CHARS = 200_000;

export function saveDraft(ctx: Ctx, userId: number, kind: DraftKind, json: string): void {
  requirePermission(ctx, userId, NEEDS[kind]);
  if (json.length > MAX_CHARS) throw new DomainError('VALIDATION', 'This bill is too large to keep as a draft');
  ctx.db
    .prepare('INSERT INTO bill_drafts (user_id, kind, payload_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at')
    .run(userId, kind, json, ctx.now());
}

const remove = (ctx: Ctx, userId: number, kind: DraftKind) => ctx.db.prepare('DELETE FROM bill_drafts WHERE user_id = ? AND kind = ?').run(userId, kind).changes;

/** True when the draft can be shown. A sale draft whose bill was paid before the app stopped cannot. */
function usable(ctx: Ctx, kind: DraftKind, json: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return false;
  }
  if (kind !== 'sale') return isSupplierDraft(value);
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) return false;
  return !parsed.data.billKey || !ctx.db.prepare('SELECT 1 FROM sales WHERE idempotency_key = ?').get(parsed.data.billKey);
}

export function loadDraft(ctx: Ctx, userId: number, kind: DraftKind): { json: string; updatedAt: string } | null {
  requirePermission(ctx, userId, NEEDS[kind]);
  const row = ctx.db.prepare('SELECT payload_json AS json, updated_at AS updatedAt FROM bill_drafts WHERE user_id = ? AND kind = ?').get(userId, kind) as { json: string; updatedAt: string } | undefined;
  if (!row) return null;
  if (usable(ctx, kind, row.json)) return row;
  remove(ctx, userId, kind);
  return null;
}

/** After the bill was finished, held or emptied. */
export function clearDraft(ctx: Ctx, userId: number, kind: DraftKind): void {
  requirePermission(ctx, userId, NEEDS[kind]);
  remove(ctx, userId, kind);
}

/** The user chose not to bring it back. */
export function discardDraft(ctx: Ctx, userId: number, kind: DraftKind): void {
  requirePermission(ctx, userId, NEEDS[kind]);
  ctx.db.transaction(() => {
    if (remove(ctx, userId, kind)) appendAudit(ctx, { userId, action: 'bill.draft_discarded', entity: 'bill_draft', entityId: kind });
  })();
}

export function markDraftRestored(ctx: Ctx, userId: number, kind: DraftKind): void {
  requirePermission(ctx, userId, NEEDS[kind]);
  appendAudit(ctx, { userId, action: 'bill.draft_restored', entity: 'bill_draft', entityId: kind });
}
