import { createHash } from 'node:crypto';
import type { Ctx } from './context';

const GENESIS = '0'.repeat(64);

export interface AuditInput {
  userId: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
}

interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details_json: string;
  prev_hash: string;
  hash: string;
}

function rowHash(r: Omit<AuditRow, 'id' | 'hash'>): string {
  const canonical = JSON.stringify([r.prev_hash, r.at, r.user_id, r.action, r.entity, r.entity_id, r.details_json]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Appends a hash-chained audit row. Call inside the same transaction as the action it records. */
export function appendAudit(ctx: Ctx, input: AuditInput): void {
  const prev = ctx.db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const row = {
    prev_hash: prev?.hash ?? GENESIS,
    at: ctx.now(),
    user_id: input.userId,
    action: input.action,
    entity: input.entity,
    entity_id: input.entityId == null ? null : String(input.entityId),
    details_json: JSON.stringify(input.details ?? {}),
  };
  ctx.db
    .prepare(
      `INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash)
       VALUES (@at, @user_id, @action, @entity, @entity_id, @details_json, @prev_hash, @hash)`,
    )
    .run({ ...row, hash: rowHash(row) });
}

/** Returns the id of the first broken row, or null if the whole chain verifies. */
export function verifyAuditChain(ctx: Ctx): number | null {
  let prev = GENESIS;
  for (const r of ctx.db.prepare('SELECT * FROM audit_log ORDER BY id').iterate() as IterableIterator<AuditRow>) {
    if (r.prev_hash !== prev || rowHash(r) !== r.hash) return r.id;
    prev = r.hash;
  }
  return null;
}
