import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SyncEvent } from '../shared/snapshots.ts';
import type { Db, Statement } from './db-types.ts';

// The POS's side of the cloud. The store is always taken from the device's credential, never from the request body.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface Device {
  deviceId: string;
  storeId: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rateLimit(db: Db, key: string, max: number, windowMinutes: number) {
  const [r] = await db.query<{ n: number | string }>('SELECT count(*) AS n FROM cloud.rate_limits WHERE key = $1 AND at > now() - make_interval(mins => $2)', [key, windowMinutes]);
  if (Number(r?.n ?? 0) >= max) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  await db.query('INSERT INTO cloud.rate_limits (key) VALUES ($1)', [key]);
  await db.query("DELETE FROM cloud.rate_limits WHERE key = $1 AND at < now() - interval '1 day'", [key]);
}

const audit = (storeId: string | null, deviceId: string | null, action: string, detail: object = {}): Statement => ({ text: 'INSERT INTO cloud.audit_log (store_id, device_id, action, detail) VALUES ($1, $2, $3, $4)', params: [storeId, deviceId, action, JSON.stringify(detail)] });

function newCredential(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: sha(secret) };
}

export const enrollBody = z.object({ code: z.string().min(8).max(64), deviceName: z.string().min(1).max(80), appVersion: z.string().max(30).optional(), recoveryVerifier: z.string().regex(/^[0-9a-f]{64}$/).optional() });

/** One-time code → a device credential. The code is created by the owner with `npm run store:create`. */
export async function enrollDevice(db: Db, ip: string, input: z.infer<typeof enrollBody>): Promise<{ storeId: string; deviceId: string; deviceSecret: string }> {
  await rateLimit(db, `enroll:${sha(ip).slice(0, 32)}`, 10, 60);
  const [c] = await db.query<{ store_id: string }>('SELECT store_id FROM cloud.enrollment_codes WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha(input.code.trim())]);
  if (!c) throw new ApiError(401, 'BAD_CODE', 'That code is wrong, used or expired.');
  const cred = newCredential();
  const [row] = await db.query<{ id: string }>('INSERT INTO cloud.devices (store_id, name, secret_hash, app_version) VALUES ($1, $2, $3, $4) RETURNING id', [c.store_id, input.deviceName, cred.hash, input.appVersion ?? null]);
  const statements: Statement[] = [{ text: 'UPDATE cloud.enrollment_codes SET used_at = now() WHERE code_hash = $1', params: [sha(input.code.trim())] }, audit(c.store_id, row!.id, 'device.enrolled', { name: input.deviceName })];
  if (input.recoveryVerifier) statements.push({ text: 'UPDATE cloud.stores SET recovery_verifier = $1 WHERE id = $2', params: [input.recoveryVerifier, c.store_id] });
  await db.batch(statements);
  return { storeId: c.store_id, deviceId: row!.id, deviceSecret: cred.secret };
}

export const recoverBody = z.object({ storeId: z.uuid(), recoveryToken: z.string().min(32).max(128), deviceName: z.string().min(1).max(80), revokeOthers: z.boolean().default(true) });

/** A replacement computer proves it holds the recovery code. Other devices are cut off unless the owner says not to. */
export async function recoverDevice(db: Db, ip: string, input: z.infer<typeof recoverBody>): Promise<{ storeId: string; deviceId: string; deviceSecret: string }> {
  await rateLimit(db, `recover:${sha(ip).slice(0, 32)}`, 10, 60);
  await rateLimit(db, `recover:${input.storeId}`, 10, 60);
  const [s] = await db.query<{ recovery_verifier: string | null }>('SELECT recovery_verifier FROM cloud.stores WHERE id = $1', [input.storeId]);
  const given = Buffer.from(sha(input.recoveryToken));
  const want = Buffer.from(s?.recovery_verifier ?? '0'.repeat(64));
  if (!s?.recovery_verifier || !timingSafeEqual(given, want)) throw new ApiError(401, 'BAD_RECOVERY', 'The recovery code does not match this store.');
  const cred = newCredential();
  const [row] = await db.query<{ id: string }>('INSERT INTO cloud.devices (store_id, name, secret_hash) VALUES ($1, $2, $3) RETURNING id', [input.storeId, input.deviceName, cred.hash]);
  const statements: Statement[] = [audit(input.storeId, row!.id, 'device.recovered', { name: input.deviceName, revokedOthers: input.revokeOthers })];
  if (input.revokeOthers) statements.push({ text: "UPDATE cloud.devices SET status = 'revoked' WHERE store_id = $1 AND id <> $2", params: [input.storeId, row!.id] });
  await db.batch(statements);
  return { storeId: input.storeId, deviceId: row!.id, deviceSecret: cred.secret };
}

/** `Authorization: Bearer <deviceId>.<secret>` */
export async function authenticate(db: Db, header: string | null): Promise<Device> {
  const fail = new ApiError(401, 'UNAUTHORIZED', 'Device not recognised.');
  const m = /^Bearer ([^.\s]+)\.([\w-]{20,128})$/.exec(header ?? '');
  if (!m || !UUID.test(m[1]!)) throw fail;
  const [d] = await db.query<{ store_id: string; secret_hash: string; status: string }>('SELECT store_id, secret_hash, status FROM cloud.devices WHERE id = $1', [m[1]]);
  if (!d || !timingSafeEqual(Buffer.from(sha(m[2]!)), Buffer.from(d.secret_hash)) || d.status !== 'active') throw fail;
  await db.query('UPDATE cloud.devices SET last_seen_at = now() WHERE id = $1', [m[1]]);
  return { deviceId: m[1]!, storeId: d.store_id };
}

/**
 * Stores what is new. Each event id is applied once. For one (kind, key) the highest version wins, so a delayed
 * retry can never overwrite newer figures. Everything happens in one transaction, and then the ids are confirmed.
 */
export async function ingest(db: Db, device: Device, events: SyncEvent[], appVersion?: string): Promise<{ acceptedIds: string[]; applied: number }> {
  const ids = events.map((e) => e.eventId);
  const seen = await db.query<{ event_id: string; store_id: string }>('SELECT event_id, store_id FROM sync.events WHERE event_id = ANY($1::uuid[])', [ids]);
  if (seen.some((r) => r.store_id !== device.storeId)) throw new ApiError(409, 'EVENT_CONFLICT', 'An event id belongs to another store.');
  const known = new Set(seen.map((r) => r.event_id));
  const fresh = [...new Map(events.filter((e) => !known.has(e.eventId)).map((e) => [e.eventId, e])).values()];
  if (fresh.length === 0) return { acceptedIds: ids, applied: 0 };

  const keys = fresh.map((e) => `${e.kind}|${e.snapKey}`);
  const current = new Map((await db.query<{ k: string; version: number }>("SELECT kind || '|' || snap_key AS k, version FROM readmodel.snapshots WHERE store_id = $1 AND kind || '|' || snap_key = ANY($2::text[])", [device.storeId, keys])).map((r) => [r.k, r.version]));

  const statements: Statement[] = [];
  let applied = 0;
  let newest = '';
  for (const e of [...fresh].sort((a, b) => a.version - b.version)) {
    const k = `${e.kind}|${e.snapKey}`;
    const wins = e.version > (current.get(k) ?? 0);
    if (wins) {
      current.set(k, e.version);
      applied++;
      if (e.createdAt > newest) newest = e.createdAt;
      statements.push({
        text: `INSERT INTO readmodel.snapshots (store_id, kind, snap_key, version, payload, source_created_at) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (store_id, kind, snap_key) DO UPDATE SET version = excluded.version, payload = excluded.payload, source_created_at = excluded.source_created_at, received_at = now()
               WHERE excluded.version > readmodel.snapshots.version`,
        params: [device.storeId, e.kind, e.snapKey, e.version, JSON.stringify(e.payload), e.createdAt],
      });
    }
    statements.push({ text: 'INSERT INTO sync.events (event_id, store_id, device_id, kind, snap_key, version, applied) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING', params: [e.eventId, device.storeId, device.deviceId, e.kind, e.snapKey, e.version, wins] });
  }
  const [store] = await db.query<{ name: string }>('SELECT name FROM cloud.stores WHERE id = $1', [device.storeId]);
  const [dev] = await db.query<{ name: string }>('SELECT name FROM cloud.devices WHERE id = $1', [device.deviceId]);
  statements.push({
    text: `INSERT INTO readmodel.status (store_id, store_name, device_name, app_version, last_success_at, last_data_at) VALUES ($1, $2, $3, $4, now(), $5)
           ON CONFLICT (store_id) DO UPDATE SET store_name = excluded.store_name, device_name = excluded.device_name, app_version = COALESCE(excluded.app_version, readmodel.status.app_version), last_success_at = now(),
             last_data_at = GREATEST(readmodel.status.last_data_at, excluded.last_data_at)`,
    params: [device.storeId, store?.name ?? '', dev?.name ?? '', appVersion ?? null, newest || null],
  });
  statements.push(audit(device.storeId, device.deviceId, 'sync.batch', { events: fresh.length, applied }));
  await db.batch(statements);
  return { acceptedIds: ids, applied };
}

/** Called with a successful sync-less contact, so a POS with no new figures still shows as connected. */
export async function heartbeat(db: Db, device: Device, appVersion?: string): Promise<void> {
  const [store] = await db.query<{ name: string }>('SELECT name FROM cloud.stores WHERE id = $1', [device.storeId]);
  const [dev] = await db.query<{ name: string }>('SELECT name FROM cloud.devices WHERE id = $1', [device.deviceId]);
  await db.query(
    `INSERT INTO readmodel.status (store_id, store_name, device_name, app_version, last_success_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (store_id) DO UPDATE SET device_name = excluded.device_name, app_version = COALESCE(excluded.app_version, readmodel.status.app_version), last_success_at = now()`,
    [device.storeId, store?.name ?? '', dev?.name ?? '', appVersion ?? null],
  );
}
