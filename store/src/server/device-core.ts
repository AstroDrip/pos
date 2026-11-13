import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import type { SyncEvent } from '../shared/commerce-events.ts';
import { ApiError } from './errors.ts';

// The POS's side of the commerce service. This credential is separate from the owner dashboard's.

export interface Device {
  deviceId: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rateLimit(db: Db, key: string, max: number, windowMinutes: number) {
  const [r] = await db.query<{ n: number | string }>('SELECT count(*) AS n FROM commerce.rate_limits WHERE key = $1 AND at > now() - make_interval(mins => $2)', [key, windowMinutes]);
  if (Number(r?.n ?? 0) >= max) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  await db.query('INSERT INTO commerce.rate_limits (key) VALUES ($1)', [key]);
  await db.query("DELETE FROM commerce.rate_limits WHERE key = $1 AND at < now() - interval '1 day'", [key]);
}

/** Applies a batch in order, each event once, in one transaction. An empty batch is the POS saying it is still there. */
export async function applyEvents(db: Db, device: Device, events: SyncEvent[], pending = 0): Promise<{ ackedSeq: number; needCheckpoint: boolean }> {
  try {
    const [r] = await db.query<{ r: { ackedSeq: number | string; needCheckpoint: boolean } }>('SELECT commerce.apply_events($1, $2::jsonb, $3::integer) AS r', [device.deviceId, JSON.stringify(events), pending]);
    return { ackedSeq: Number(r!.r.ackedSeq), needCheckpoint: r!.r.needCheckpoint === true };
  } catch (e) {
    if (e instanceof Error && e.message.includes('BAD_EVENT_ID')) throw new ApiError(409, 'BAD_EVENT_ID', 'An event does not belong to this device.');
    throw e;
  }
}

/** How much is held for online orders, for the POS stock report. */
export async function reservedTotals(db: Db): Promise<{ productId: number; reserved: number }[]> {
  const rows = await db.query<{ pos_product_id: number | string; reserved: number }>('SELECT pos_product_id, reserved FROM commerce.inventory_positions WHERE reserved > 0 ORDER BY pos_product_id');
  return rows.map((r) => ({ productId: Number(r.pos_product_id), reserved: r.reserved }));
}

/** Commands for the POS, oldest first, after the last one it has. */
export async function pendingCommands(db: Db, after: number): Promise<{ id: number; type: string; payload: unknown }[]> {
  const rows = await db.query<{ id: number | string; type: string; payload: unknown }>('SELECT id, type, payload FROM commerce.pos_commands WHERE id > $1 AND acked_at IS NULL ORDER BY id LIMIT 100', [after]);
  return rows.map((r) => ({ id: Number(r.id), type: r.type, payload: r.payload }));
}

export async function ackCommands(db: Db, ids: number[]): Promise<void> {
  if (ids.length) await db.query('UPDATE commerce.pos_commands SET acked_at = now() WHERE id = ANY($1::bigint[]) AND acked_at IS NULL', [ids]);
}

export const enrollBody = z.strictObject({ code: z.string().min(8).max(64), deviceName: z.string().min(1).max(80), appVersion: z.string().max(30).optional() });

/** One-time code to device credential. The code is created by the owner with `npm run device:code`. */
export async function enrollDevice(db: Db, ip: string, input: z.infer<typeof enrollBody>): Promise<{ deviceId: string; deviceSecret: string }> {
  await rateLimit(db, `enroll:${sha(ip).slice(0, 32)}`, 10, 60);
  // Claiming the code in one statement means two calls cannot both use it.
  const [claimed] = await db.query('UPDATE commerce.enrollment_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING code_hash', [sha(input.code.trim())]);
  if (!claimed) throw new ApiError(401, 'BAD_CODE', 'That code is wrong, used or expired.');
  const secret = randomBytes(32).toString('base64url');
  const [row] = await db.query<{ id: string }>('INSERT INTO commerce.devices (name, secret_hash, app_version) VALUES ($1, $2, $3) RETURNING id', [input.deviceName, sha(secret), input.appVersion ?? null]);
  await db.query("INSERT INTO commerce.audit_log (actor, actor_id, action, entity, detail) VALUES ('device', $1, 'device.enrolled', 'device', $2)", [row!.id, JSON.stringify({ name: input.deviceName })]);
  return { deviceId: row!.id, deviceSecret: secret };
}

/** `Authorization: Bearer <deviceId>.<secret>` */
export async function authenticate(db: Db, header: string | null): Promise<Device> {
  const fail = new ApiError(401, 'UNAUTHORIZED', 'Device not recognised.');
  const m = /^Bearer ([^.\s]+)\.([\w-]{20,128})$/.exec(header ?? '');
  if (!m || !UUID.test(m[1]!)) throw fail;
  const [d] = await db.query<{ secret_hash: string; status: string }>('SELECT secret_hash, status FROM commerce.devices WHERE id = $1', [m[1]]);
  if (!d || !timingSafeEqual(Buffer.from(sha(m[2]!)), Buffer.from(d.secret_hash)) || d.status !== 'active') throw fail;
  await db.query('UPDATE commerce.devices SET last_contact_at = now() WHERE id = $1', [m[1]]); // contact only: being up to date is decided by the sync
  return { deviceId: m[1]! };
}
