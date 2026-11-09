import { createHash } from 'node:crypto';
import type { Ctx } from './context';

const GENESIS = '0'.repeat(64);

export interface AuditInput {
  userId: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
  /** Old and new values of what changed. */
  before?: unknown;
  after?: unknown;
  reason?: string;
  /** Another record this one belongs to, such as the original sale of a refund. */
  related?: { type: string; id: string | number };
  status?: 'ok' | 'failed';
}

const SECRET_WORDS = new Set(['pin', 'password', 'passwd', 'secret', 'token', 'key', 'csid']);
const SAFE_NAMES = new Set(['billKey', 'requestKey', 'idempotencyKey']); // these link records together and are not secret

function isSecretName(name: string): boolean {
  if (SAFE_NAMES.has(name)) return false;
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).some((w) => SECRET_WORDS.has(w));
}

/** A copy with every secret field taken out, at any depth. Nothing secret may ever reach the log. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !isSecretName(k)).map(([k, x]) => [k, redact(x)]));
}

/** Facts true at this moment, kept with the record because users and shifts change later. */
function context(ctx: Ctx, input: AuditInput): Record<string, unknown> {
  const who = input.userId === null ? undefined : (ctx.db
    .prepare('SELECT u.display_name AS name, group_concat(r.code) AS role FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.id = ? GROUP BY u.id')
    .get(input.userId) as { name: string; role: string | null } | undefined);
  const device = ctx.db.prepare("SELECT value FROM settings WHERE key = 'device_id'").get() as { value: string } | undefined;
  const shift = ctx.db.prepare("SELECT id FROM register_shifts WHERE status = 'open'").get() as { id: number } | undefined;
  const details = input.details ?? {};
  const before = input.before ?? details.before;
  const after = input.after ?? details.after;
  return {
    actor: who?.name ?? null,
    role: who?.role ?? null,
    screen: ctx.screen ?? null,
    device: device?.value ?? null,
    shift: shift?.id ?? null,
    status: input.status ?? 'ok',
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.related ? { related: input.related } : {}),
  };
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
    details_json: JSON.stringify(redact({ ...(input.details ?? {}), _m: context(ctx, input) })),
  };
  ctx.db
    .prepare(
      `INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash)
       VALUES (@at, @user_id, @action, @entity, @entity_id, @details_json, @prev_hash, @hash)`,
    )
    .run({ ...row, hash: rowHash(row) });
}

/** Records a refused or failed action. Runs after the action's own transaction was undone. Never throws. */
export function appendFailure(ctx: Ctx, userId: number | null, channel: string, code: string): void {
  try {
    ctx.db.transaction(() => appendAudit(ctx, { userId, action: code === 'PERMISSION_DENIED' ? 'denied' : 'failed', entity: 'channel', entityId: channel, details: { code }, status: 'failed' }))();
  } catch (e) {
    console.error('[audit] could not record a failed action', e);
  }
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
