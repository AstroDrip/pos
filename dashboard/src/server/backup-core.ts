import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db, Statement } from './db-types.ts';
import { ApiError, type Device } from './device-core.ts';

// Encrypted backups, in pieces that fit a serverless request. The server cannot read them: it holds no key.
// Sizes and hashes from the POS are checks to pass, not facts to trust.

export const MAX_CHUNK = 2 * 1024 * 1024;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const backupId = z.string().regex(/^[\w-]{8,64}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const startBody = z.object({
  backupId,
  createdAt: z.iso.datetime(),
  appVersion: z.string().min(1).max(30),
  schemaVersion: z.number().int().positive(),
  formatVersion: z.number().int().positive(),
  encryptionVersion: z.number().int().positive(),
  originalBytes: z.number().int().positive().safe(),
  encryptedBytes: z.number().int().positive().safe(),
  sha256: hex64,
  chunkCount: z.number().int().positive().max(100_000),
  chunkSize: z.number().int().positive().max(MAX_CHUNK),
  chunksRoot: hex64,
});

interface Manifest {
  backup_id: string; chunk_count: number; chunk_size: number; encrypted_bytes: number | string; chunks_root: string; sha256: string; upload_status: string; verification_status: string;
}

async function manifest(db: Db, d: Device, id: string): Promise<Manifest> {
  const [m] = await db.query<Manifest>('SELECT backup_id, chunk_count, chunk_size, encrypted_bytes, chunks_root, sha256, upload_status, verification_status FROM backup.manifests WHERE store_id = $1 AND backup_id = $2', [d.storeId, id]);
  if (!m) throw new ApiError(404, 'NOT_FOUND', 'Backup not found.');
  return m;
}

/** Starts or resumes an upload. Returns the pieces already stored, so only the rest are sent. */
export async function startUpload(db: Db, d: Device, b: z.infer<typeof startBody>): Promise<{ have: number[]; status: string }> {
  if (Math.ceil(b.encryptedBytes / b.chunkSize) !== b.chunkCount) throw new ApiError(400, 'BAD_SIZE', 'Size and piece count do not agree.');
  const [m] = await db.query<Manifest>('SELECT * FROM backup.manifests WHERE store_id = $1 AND backup_id = $2', [d.storeId, b.backupId]);
  if (m) {
    if (m.sha256 !== b.sha256 || m.chunks_root !== b.chunksRoot || m.chunk_count !== b.chunkCount) throw new ApiError(409, 'DIFFERENT_BACKUP', 'A different backup has this id.');
    if (m.upload_status === 'uploaded') return { have: Array.from({ length: m.chunk_count }, (_, i) => i), status: 'uploaded' };
  } else {
    await db.batch([
      {
        text: `INSERT INTO backup.manifests (store_id, backup_id, device_id, client_created_at, app_version, schema_version, format_version, encryption_version, original_bytes, encrypted_bytes, sha256, chunk_count, chunk_size, chunks_root)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        params: [d.storeId, b.backupId, d.deviceId, b.createdAt, b.appVersion, b.schemaVersion, b.formatVersion, b.encryptionVersion, b.originalBytes, b.encryptedBytes, b.sha256, b.chunkCount, b.chunkSize, b.chunksRoot],
      },
      { text: 'INSERT INTO backup.upload_sessions (store_id, backup_id, device_id) VALUES ($1, $2, $3)', params: [d.storeId, b.backupId, d.deviceId] },
    ]);
  }
  const rows = await db.query<{ idx: number }>('SELECT idx FROM backup.chunks WHERE store_id = $1 AND backup_id = $2 ORDER BY idx', [d.storeId, b.backupId]);
  return { have: rows.map((r) => r.idx), status: 'uploading' };
}

/** Stores one piece. Sending the same piece again is a no-op, so a retry after a timeout is safe. */
export async function putChunk(db: Db, d: Device, id: string, idx: number, claimedSha: string, data: Buffer): Promise<{ stored: boolean }> {
  if (!backupId.safeParse(id).success || !Number.isInteger(idx) || idx < 0) throw new ApiError(400, 'BAD_REQUEST', 'Bad piece.');
  if (data.length === 0 || data.length > MAX_CHUNK) throw new ApiError(413, 'TOO_LARGE', 'Piece is too large.');
  if (sha(data) !== claimedSha) throw new ApiError(400, 'BAD_HASH', 'Piece was damaged on the way.');
  const m = await manifest(db, d, id);
  if (m.upload_status === 'uploaded') return { stored: false };
  if (idx >= m.chunk_count) throw new ApiError(400, 'BAD_INDEX', 'Piece number is out of range.');
  const last = idx === m.chunk_count - 1;
  const lastSize = Number(m.encrypted_bytes) - m.chunk_size * (m.chunk_count - 1);
  if (data.length !== (last ? lastSize : m.chunk_size)) throw new ApiError(400, 'BAD_SIZE', 'Piece has the wrong size.');
  const [done] = await db.query<{ sha256: string }>('SELECT sha256 FROM backup.chunks WHERE store_id = $1 AND backup_id = $2 AND idx = $3', [d.storeId, id, idx]);
  if (done) {
    if (done.sha256 !== claimedSha) throw new ApiError(409, 'DIFFERENT_PIECE', 'A different piece is already stored here.');
    return { stored: false };
  }
  await db.batch([
    { text: "INSERT INTO backup.chunks (store_id, backup_id, idx, sha256, bytes, data) VALUES ($1, $2, $3, $4, $5, decode($6, 'base64')) ON CONFLICT DO NOTHING", params: [d.storeId, id, idx, claimedSha, data.length, data.toString('base64')] },
    { text: "UPDATE backup.upload_sessions SET last_chunk_at = now() WHERE store_id = $1 AND backup_id = $2 AND status = 'open'", params: [d.storeId, id] },
  ]);
  return { stored: true };
}

/** Closes an upload after the server's own check of every piece hash. Then applies retention. */
export async function finishUpload(db: Db, d: Device, id: string): Promise<{ status: string; verification: string; removed: string[] }> {
  const m = await manifest(db, d, id);
  if (m.upload_status === 'uploaded') return { status: 'uploaded', verification: m.verification_status, removed: [] };
  const rows = await db.query<{ idx: number; sha256: string; bytes: number }>('SELECT idx, sha256, bytes FROM backup.chunks WHERE store_id = $1 AND backup_id = $2 ORDER BY idx', [d.storeId, id]);
  const complete = rows.length === m.chunk_count && rows.every((r, i) => r.idx === i);
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  const root = sha(rows.map((r) => r.sha256).join(''));
  if (!complete) throw new ApiError(409, 'INCOMPLETE', `Only ${rows.length} of ${m.chunk_count} pieces are stored.`);
  const ok = bytes === Number(m.encrypted_bytes) && root === m.chunks_root;
  await db.batch([
    { text: `UPDATE backup.manifests SET upload_status = $3, verification_status = $4, uploaded_at = now(), verified_at = CASE WHEN $5::boolean THEN now() ELSE NULL END WHERE store_id = $1 AND backup_id = $2`, params: [d.storeId, id, ok ? 'uploaded' : 'failed', ok ? 'server_ok' : 'failed', ok] },
    { text: "UPDATE backup.upload_sessions SET status = 'finished', finished_at = now() WHERE store_id = $1 AND backup_id = $2 AND status = 'open'", params: [d.storeId, id] },
    { text: "INSERT INTO backup.verifications (store_id, backup_id, device_id, kind, ok, detail) VALUES ($1, $2, $3, 'server', $4, $5)", params: [d.storeId, id, d.deviceId, ok, ok ? null : 'Piece hashes or total size do not match the manifest'] },
  ]);
  if (!ok) throw new ApiError(422, 'VERIFY_FAILED', 'The stored backup does not match its manifest.');
  return { status: 'uploaded', verification: 'server_ok', removed: await applyRetention(db, d) };
}

export interface RetentionItem {
  backupId: string;
  createdAt: string;
  verified: boolean;
}

/**
 * Keeps the newest verified backup always, the newest verified one of each of the last N days, and of each of the
 * last M weeks. A backup not yet verified is left alone, and failed or unfinished ones are removed after two days.
 */
export function chooseRemovals(items: RetentionItem[], keepDaily: number, keepWeekly: number): string[] {
  const verified = items.filter((i) => i.verified).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set<string>();
  if (verified[0]) keep.add(verified[0].backupId);
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const v of verified) {
    const day = v.createdAt.slice(0, 10);
    if (!days.has(day) && days.size < keepDaily) {
      days.add(day);
      keep.add(v.backupId);
    }
    const week = String(Math.floor(Date.parse(`${day}T00:00:00Z`) / (7 * 86_400_000)));
    if (!weeks.has(week) && weeks.size < keepWeekly) {
      weeks.add(week);
      keep.add(v.backupId);
    }
  }
  return verified.filter((v) => !keep.has(v.backupId)).map((v) => v.backupId);
}

export async function applyRetention(db: Db, d: Device): Promise<string[]> {
  const [s] = await db.query<{ retention_daily: number; retention_weekly: number }>('SELECT retention_daily, retention_weekly FROM cloud.stores WHERE id = $1', [d.storeId]);
  const rows = await db.query<{ backup_id: string; created: string; verification_status: string; encrypted_bytes: number | string }>(
    `SELECT backup_id, to_char(client_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS created, verification_status, encrypted_bytes FROM backup.manifests WHERE store_id = $1 AND upload_status = 'uploaded'`,
    [d.storeId],
  );
  const removed = chooseRemovals(rows.map((r) => ({ backupId: r.backup_id, createdAt: r.created, verified: r.verification_status === 'server_ok' || r.verification_status === 'full_ok' })), s?.retention_daily ?? 7, s?.retention_weekly ?? 4);
  const statements: Statement[] = [];
  for (const id of removed) {
    const r = rows.find((x) => x.backup_id === id)!;
    statements.push({ text: "INSERT INTO backup.retention_log (store_id, backup_id, bytes, reason) VALUES ($1, $2, $3, 'retention')", params: [d.storeId, id, r.encrypted_bytes] });
    statements.push({ text: 'DELETE FROM backup.manifests WHERE store_id = $1 AND backup_id = $2', params: [d.storeId, id] });
  }
  // Uploads that never finished, or failed the check, take space and can never be restored.
  const stale = await db.query<{ backup_id: string; encrypted_bytes: number | string }>("SELECT backup_id, encrypted_bytes FROM backup.manifests WHERE store_id = $1 AND upload_status <> 'uploaded' AND client_created_at < now() - interval '2 days'", [d.storeId]);
  for (const r of stale) {
    statements.push({ text: "INSERT INTO backup.retention_log (store_id, backup_id, bytes, reason) VALUES ($1, $2, $3, 'unfinished')", params: [d.storeId, r.backup_id, r.encrypted_bytes] });
    statements.push({ text: 'DELETE FROM backup.manifests WHERE store_id = $1 AND backup_id = $2', params: [d.storeId, r.backup_id] });
  }
  if (statements.length) await db.batch(statements);
  return removed;
}

export interface BackupRow {
  backupId: string; createdAt: string; appVersion: string; schemaVersion: number; formatVersion: number; encryptionVersion: number; originalBytes: number; encryptedBytes: number; sha256: string; chunkCount: number; chunkSize: number; uploadStatus: string; verificationStatus: string; uploadedAt: string | null; verifiedAt: string | null;
}

export async function listBackups(db: Db, d: Device): Promise<BackupRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT backup_id, client_created_at, app_version, schema_version, format_version, encryption_version, original_bytes, encrypted_bytes, sha256, chunk_count, chunk_size, upload_status, verification_status, uploaded_at, verified_at
     FROM backup.manifests WHERE store_id = $1 ORDER BY client_created_at DESC LIMIT 200`,
    [d.storeId],
  );
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
  return rows.map((r) => ({
    backupId: r.backup_id as string, createdAt: iso(r.client_created_at)!, appVersion: r.app_version as string, schemaVersion: Number(r.schema_version), formatVersion: Number(r.format_version), encryptionVersion: Number(r.encryption_version),
    originalBytes: Number(r.original_bytes), encryptedBytes: Number(r.encrypted_bytes), sha256: r.sha256 as string, chunkCount: Number(r.chunk_count), chunkSize: Number(r.chunk_size), uploadStatus: r.upload_status as string, verificationStatus: r.verification_status as string, uploadedAt: iso(r.uploaded_at), verifiedAt: iso(r.verified_at),
  }));
}

export async function getChunk(db: Db, d: Device, id: string, idx: number): Promise<{ data: Buffer; sha256: string }> {
  if (!backupId.safeParse(id).success || !Number.isInteger(idx) || idx < 0) throw new ApiError(400, 'BAD_REQUEST', 'Bad piece.');
  const [r] = await db.query<{ b64: string; sha256: string }>("SELECT encode(data, 'base64') AS b64, sha256 FROM backup.chunks WHERE store_id = $1 AND backup_id = $2 AND idx = $3", [d.storeId, id, idx]);
  if (!r) throw new ApiError(404, 'NOT_FOUND', 'Piece not found.');
  return { data: Buffer.from(r.b64, 'base64'), sha256: r.sha256 };
}

export const verifiedBody = z.object({ backupId, ok: z.boolean(), detail: z.string().max(300).optional() });

/** The POS downloaded the whole backup and decrypted it. Only the POS can make this check. */
export async function recordFullVerify(db: Db, d: Device, b: z.infer<typeof verifiedBody>): Promise<void> {
  await manifest(db, d, b.backupId);
  await db.batch([
    { text: "UPDATE backup.manifests SET verification_status = $3, verified_at = now() WHERE store_id = $1 AND backup_id = $2", params: [d.storeId, b.backupId, b.ok ? 'full_ok' : 'failed'] },
    { text: "INSERT INTO backup.verifications (store_id, backup_id, device_id, kind, ok, detail) VALUES ($1, $2, $3, 'full', $4, $5)", params: [d.storeId, b.backupId, d.deviceId, b.ok, b.detail ?? null] },
  ]);
}

export const restoreBody = z.object({ backupId, status: z.enum(['downloaded', 'restored', 'failed']), detail: z.string().max(300).optional() });

export async function recordRestore(db: Db, d: Device, b: z.infer<typeof restoreBody>): Promise<void> {
  await db.query('INSERT INTO backup.restore_history (store_id, backup_id, device_id, status, detail) VALUES ($1, $2, $3, $4, $5)', [d.storeId, b.backupId, d.deviceId, b.status, b.detail ?? null]);
}

export const verifierBody = z.object({ recoveryVerifier: hex64 });

export async function setRecoveryVerifier(db: Db, d: Device, b: z.infer<typeof verifierBody>): Promise<void> {
  await db.batch([
    { text: 'UPDATE cloud.stores SET recovery_verifier = $1 WHERE id = $2', params: [b.recoveryVerifier, d.storeId] },
    { text: 'INSERT INTO cloud.audit_log (store_id, device_id, action) VALUES ($1, $2, $3)', params: [d.storeId, d.deviceId, 'recovery.verifier_set'] },
  ]);
}
