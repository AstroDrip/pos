import { createHash, hkdfSync } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from '../db/migrations';
import { appendAudit } from './audit';
import { prepareRestore } from './backup';
import { readManifest, type BackupManifest } from './backup-crypto';
import { CloudError, type CloudApi, type ErrorKind, type RemoteBackup } from './cloud-client';
import { DomainError, type Ctx } from './context';

// Copies verified local backups to the cloud. The file is already encrypted before this code sees it, and the
// key never leaves this computer. Uploads go in pieces, survive restarts, and never hold up a sale.

export const CHUNK_BYTES = 2 * 1024 * 1024;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** A one-way login proof derived from the backup key. The key itself, and the recovery code, are never sent. */
export function recoveryToken(masterKey: Buffer): string {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('pos-cloud'), Buffer.from('recovery-auth-v1'), 32)).toString('base64url');
}
export const recoveryVerifier = (masterKey: Buffer) => sha(recoveryToken(masterKey));

export function backupEveryHours(ctx: Ctx): number {
  const r = ctx.db.prepare("SELECT value FROM settings WHERE key = 'cloud_backup_every_hours'").get() as { value: string } | undefined;
  const n = Number(r?.value ?? 24);
  return Number.isInteger(n) && n > 0 ? n : 24;
}

export function setBackupEveryHours(ctx: Ctx, userId: number, hours: number): void {
  ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'cloud_backup_every_hours'").run(String(hours));
  appendAudit(ctx, { userId, action: 'backup.schedule', entity: 'settings', entityId: 'cloud_backup_every_hours', details: { hours } });
}

/** Queues the newest verified local backup that has not been sent. Older unsent ones are not worth the upload. */
export function queueNewestBackup(ctx: Ctx): string | null {
  const job = ctx.db.prepare("SELECT file_name, manifest_json, size_bytes FROM backup_jobs WHERE status = 'verified_local' AND trigger <> 'pre_restore' ORDER BY id DESC LIMIT 1").get() as { file_name: string; manifest_json: string; size_bytes: number } | undefined;
  if (!job) return null;
  const m = JSON.parse(job.manifest_json) as BackupManifest;
  if (ctx.db.prepare('SELECT 1 FROM cloud_uploads WHERE backup_id = ?').get(m.backupId)) return null;
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE cloud_uploads SET status = 'superseded' WHERE status = 'queued'").run();
    ctx.db.prepare("INSERT INTO cloud_uploads (backup_id, file_name, created_at, encrypted_bytes, original_bytes, status, next_try_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)").run(m.backupId, job.file_name, m.createdAt, job.size_bytes, m.plainBytes, ctx.now());
  })();
  return m.backupId;
}

interface UploadRow { backup_id: string; file_name: string; attempts: number }

function classify(e: unknown): { kind: ErrorKind; message: string } {
  if (e instanceof CloudError) return { kind: e.kind, message: e.message };
  return { kind: 'remote', message: 'The upload stopped unexpectedly' };
}

function retryLater(ctx: Ctx, row: UploadRow, e: unknown) {
  const { kind, message } = classify(e);
  const delay = Math.min(60_000 * 2 ** row.attempts, 3_600_000);
  ctx.db.prepare('UPDATE cloud_uploads SET attempts = attempts + 1, next_try_at = ?, last_error = ?, error_kind = ? WHERE backup_id = ?').run(new Date(Date.parse(ctx.now()) + delay).toISOString(), message, kind, row.backup_id);
}

export function chunksOf(file: Buffer, size = CHUNK_BYTES): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < file.length; i += size) out.push(file.subarray(i, i + size));
  return out;
}

/** Sends what is due. Asks the server what it already has, so a restart or dropped link only re-sends the rest. */
export async function uploadPending(ctx: Ctx, api: CloudApi, dir: string, chunkSize = CHUNK_BYTES): Promise<{ uploaded: number; failed: boolean }> {
  const rows = ctx.db.prepare("SELECT backup_id, file_name, attempts FROM cloud_uploads WHERE status = 'queued' AND next_try_at <= ? ORDER BY created_at DESC LIMIT 1").all(ctx.now()) as UploadRow[];
  let uploaded = 0;
  let failed = false;
  for (const row of rows) {
    const path = join(dir, row.file_name);
    if (!existsSync(path)) {
      ctx.db.prepare("UPDATE cloud_uploads SET status = 'failed', last_error = 'The local file no longer exists', error_kind = 'rejected' WHERE backup_id = ?").run(row.backup_id);
      failed = true;
      continue;
    }
    try {
      const file = readFileSync(path);
      const { manifest } = readManifest(file);
      if (manifest.backupId !== row.backup_id) throw new CloudError('The local file does not match its record', 'rejected', 'MISMATCH');
      const chunks = chunksOf(file, chunkSize);
      const hashes = chunks.map((c) => sha(c));
      const { have, status } = await api.start({
        backupId: manifest.backupId, createdAt: manifest.createdAt, appVersion: manifest.appVersion, schemaVersion: manifest.schemaVersion, formatVersion: manifest.format, encryptionVersion: 1,
        originalBytes: manifest.plainBytes, encryptedBytes: file.length, sha256: sha(file), chunkCount: chunks.length, chunkSize, chunksRoot: sha(hashes.join('')),
      });
      if (status !== 'uploaded') {
        const stored = new Set(have);
        for (let i = 0; i < chunks.length; i++) if (!stored.has(i)) await api.putChunk(manifest.backupId, i, hashes[i]!, chunks[i]!);
        await api.finish(manifest.backupId);
      }
      ctx.db.prepare("UPDATE cloud_uploads SET status = 'uploaded', uploaded_at = ?, last_error = NULL, error_kind = NULL WHERE backup_id = ?").run(ctx.now(), row.backup_id);
      appendAudit(ctx, { userId: null, action: 'backup.cloud_upload', entity: 'backup', entityId: row.backup_id, details: { bytes: file.length, pieces: chunks.length, resumedPieces: have.length } });
      uploaded++;
    } catch (e) {
      failed = true;
      retryLater(ctx, row, e);
    }
  }
  return { uploaded, failed };
}

/** Fetches a backup, checking every piece and then the whole file against the manifest. */
export async function downloadBackup(api: CloudApi, row: RemoteBackup): Promise<Buffer> {
  if (row.uploadStatus !== 'uploaded') throw new DomainError('VALIDATION', 'This cloud backup is not complete');
  const parts: Buffer[] = [];
  for (let i = 0; i < row.chunkCount; i++) {
    const c = await api.getChunk(row.backupId, i);
    if (sha(c.data) !== c.sha256) throw new DomainError('VALIDATION', 'A piece of this backup is damaged');
    parts.push(c.data);
  }
  const file = Buffer.concat(parts);
  if (file.length !== row.encryptedBytes || sha(file) !== row.sha256) throw new DomainError('VALIDATION', 'This backup failed its integrity check');
  return file;
}

const LATEST_SCHEMA = () => MIGRATIONS.at(-1)!.version;

/** Downloads to a temporary place, decrypts locally, and checks the database inside. Touches nothing live. */
export async function fetchAndCheck(api: CloudApi, row: RemoteBackup, key: Buffer, stagingPath: string): Promise<BackupManifest & { verifiedCounts: Record<string, number> }> {
  const file = await downloadBackup(api, row);
  const { manifest } = readManifest(file);
  if (manifest.backupId !== row.backupId) throw new DomainError('VALIDATION', 'This backup does not match its record');
  if (manifest.schemaVersion > LATEST_SCHEMA()) throw new DomainError('VALIDATION', 'This backup is from a newer version of the app. Update the app first.');
  const tmp = `${stagingPath}.download`;
  writeFileSync(tmp, file);
  try {
    return prepareRestore(tmp, key, stagingPath);
  } catch (e) {
    rmSync(stagingPath, { force: true });
    throw new DomainError('VALIDATION', (e as Error).message);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** The manual or weekly test: can the newest cloud copy really be restored? It uses the staging file only. */
export async function verifyCloudBackup(ctx: Ctx, api: CloudApi, key: Buffer, stagingPath: string, backupId?: string): Promise<{ backupId: string; ok: boolean; detail?: string }> {
  const list = await api.list();
  const row = backupId ? list.find((b) => b.backupId === backupId) : list.find((b) => b.uploadStatus === 'uploaded');
  if (!row) throw new DomainError('NOT_FOUND', 'No cloud backup to test');
  let ok = true;
  let detail: string | undefined;
  try {
    await fetchAndCheck(api, row, key, stagingPath);
  } catch (e) {
    if (e instanceof CloudError) throw e; // the network failed, which says nothing about the backup
    ok = false;
    detail = (e as Error).message.slice(0, 280);
  } finally {
    rmSync(stagingPath, { force: true });
  }
  await api.verified(row.backupId, ok, detail);
  ctx.db.prepare('UPDATE cloud_uploads SET full_verified_at = ?, full_verify_ok = ? WHERE backup_id = ?').run(ctx.now(), ok ? 1 : 0, row.backupId);
  appendAudit(ctx, { userId: null, action: 'backup.cloud_verify', entity: 'backup', entityId: row.backupId, details: { ok } });
  return { backupId: row.backupId, ok, detail };
}

export interface RestoreComparison {
  newerLocal: boolean;
  liveSales: number;
  backupSales: number;
  liveLastSaleAt: string | null;
}

/** True when the live database holds sales the backup does not. Restoring would lose them. */
export function compareWithLive(ctx: Ctx, m: Pick<BackupManifest, 'createdAt'> & { verifiedCounts: Record<string, number> }): RestoreComparison {
  const r = ctx.db.prepare('SELECT count(*) AS n, MAX(created_at) AS last FROM sales').get() as { n: number; last: string | null };
  const backupSales = m.verifiedCounts.sales ?? 0;
  return { newerLocal: r.n > backupSales || (r.last !== null && r.last > m.createdAt), liveSales: r.n, backupSales, liveLastSaleAt: r.last };
}

export type CloudState = 'not_configured' | 'no_backup_yet' | 'ok' | 'uploading' | 'waiting_internet' | 'remote_unavailable' | 'rejected' | 'verification_failed';

export interface CloudStatus {
  state: CloudState;
  lastCloudAt: string | null;
  lastCloudBytes: number | null;
  lastFullVerifyAt: string | null;
  lastError: string | null;
  failures: number;
  pending: number;
  everyHours: number;
}

export function cloudStatus(ctx: Ctx, configured: boolean): CloudStatus {
  const last = ctx.db.prepare("SELECT uploaded_at, encrypted_bytes FROM cloud_uploads WHERE status = 'uploaded' ORDER BY uploaded_at DESC LIMIT 1").get() as { uploaded_at: string; encrypted_bytes: number } | undefined;
  const queued = ctx.db.prepare("SELECT attempts, last_error, error_kind FROM cloud_uploads WHERE status = 'queued' ORDER BY created_at DESC LIMIT 1").get() as { attempts: number; last_error: string | null; error_kind: ErrorKind | null } | undefined;
  const failedRow = ctx.db.prepare("SELECT last_error FROM cloud_uploads WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1").get() as { last_error: string | null } | undefined;
  const verify = ctx.db.prepare('SELECT full_verified_at, full_verify_ok FROM cloud_uploads WHERE full_verified_at IS NOT NULL ORDER BY full_verified_at DESC LIMIT 1').get() as { full_verified_at: string; full_verify_ok: number } | undefined;
  const failures = (ctx.db.prepare("SELECT COALESCE(SUM(attempts),0) + COUNT(CASE WHEN status = 'failed' THEN 1 END) AS n FROM cloud_uploads WHERE status IN ('queued','failed')").get() as { n: number }).n;
  let state: CloudState;
  if (!configured) state = 'not_configured';
  else if (verify && verify.full_verify_ok === 0) state = 'verification_failed';
  else if (queued?.error_kind === 'offline') state = 'waiting_internet';
  else if (queued?.error_kind === 'remote') state = 'remote_unavailable';
  else if (queued?.error_kind === 'rejected') state = 'rejected';
  else if (queued) state = 'uploading';
  else state = last ? 'ok' : 'no_backup_yet';
  return {
    state, lastCloudAt: last?.uploaded_at ?? null, lastCloudBytes: last?.encrypted_bytes ?? null, lastFullVerifyAt: verify?.full_verify_ok === 1 ? verify.full_verified_at : null,
    lastError: queued?.last_error ?? failedRow?.last_error ?? null, failures, pending: queued ? 1 : 0, everyHours: backupEveryHours(ctx),
  };
}

/** Is it time for a new backup? Counts from the newest cloud upload attempt. */
export function backupDue(ctx: Ctx): boolean {
  const r = ctx.db.prepare("SELECT MAX(created_at) AS at FROM cloud_uploads WHERE status IN ('queued','uploaded')").get() as { at: string | null };
  return r.at === null || Date.parse(ctx.now()) - Date.parse(r.at) >= backupEveryHours(ctx) * 3_600_000;
}

export function fullVerifyDue(ctx: Ctx): boolean {
  const r = ctx.db.prepare('SELECT MAX(full_verified_at) AS at FROM cloud_uploads').get() as { at: string | null };
  return r.at === null || Date.parse(ctx.now()) - Date.parse(r.at) >= 7 * 86_400_000;
}
