import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAudit } from './audit';
import { decryptBackup, encryptBackup, sha256, type BackupManifest } from './backup-crypto';
import type { Ctx } from './context';
import { requirePermission } from './users';

export type BackupTrigger = 'manual' | 'shift_close' | 'scheduled' | 'pre_restore';
export const KEEP_LOCAL = 30;

const COUNT_TABLES = ['products', 'sales', 'sale_lines', 'payments', 'stock_movements', 'journal_entries', 'journal_lines', 'audit_log', 'users'] as const;

export interface BackupOptions {
  dir: string;
  masterKey: Buffer;
  appVersion: string;
  trigger: BackupTrigger;
  userId: number | null;
}

export interface BackupStatus {
  lastVerifiedLocal: { at: string; fileName: string; sizeBytes: number } | null;
  lastFailure: { at: string; error: string } | null;
  offsite: 'not_configured';
}

/** Facts about a database snapshot, used to check a backup and to let the owner confirm a restore. */
export function inspectSnapshot(path: string): { schemaVersion: number; counts: Record<string, number>; lastInvoiceNo: string | null } {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const ok = db.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error(`integrity_check failed: ${String(ok)}`);
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('foreign_key_check failed');
    const counts: Record<string, number> = {};
    for (const t of COUNT_TABLES) counts[t] = (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    return {
      schemaVersion: (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v,
      counts,
      lastInvoiceNo: (db.prepare('SELECT invoice_no FROM sales ORDER BY id DESC LIMIT 1').get() as { invoice_no: string } | undefined)?.invoice_no ?? null,
    };
  } finally {
    db.close();
  }
}

/**
 * Makes an encrypted, verified local backup:
 * consistent snapshot (VACUUM INTO, safe with WAL) → integrity check → encrypt → write → re-read and decrypt to verify.
 * A failure is recorded and re-thrown; it never touches the live database.
 */
export function createBackup(ctx: Ctx, opts: BackupOptions): { backupId: string; fileName: string; manifest: BackupManifest } {
  if (opts.userId !== null && opts.trigger === 'manual') requirePermission(ctx, opts.userId, 'backup.run');
  mkdirSync(opts.dir, { recursive: true });
  const createdAt = ctx.now();
  const backupId = `${createdAt.replace(/[-:]/g, '').replace(/\..*/, '')}-${ctx.uuid().slice(0, 8)}`;
  const tmp = join(opts.dir, `.tmp-${backupId}.db`);
  const fileName = `pos-${backupId}.posbak`;
  const finalPath = join(opts.dir, fileName);
  try {
    ctx.db.prepare('VACUUM INTO ?').run(tmp);
    const facts = inspectSnapshot(tmp);
    const { file, manifest } = encryptBackup(readFileSync(tmp), opts.masterKey, { backupId, createdAt, appVersion: opts.appVersion, ...facts });
    writeFileSync(`${finalPath}.part`, file);
    renameSync(`${finalPath}.part`, finalPath); // never leave a half-written file under the final name
    decryptBackup(readFileSync(finalPath), opts.masterKey); // read back what is on disk
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `INSERT INTO backup_jobs (created_at, trigger, user_id, file_name, size_bytes, file_sha256, key_id, status, manifest_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'verified_local', ?)`,
        )
        .run(createdAt, opts.trigger, opts.userId, fileName, file.length, sha256(file), manifest.keyId, JSON.stringify({ ...manifest, wrap: undefined }));
      appendAudit(ctx, { userId: opts.userId, action: 'backup.create', entity: 'backup', entityId: backupId, details: { trigger: opts.trigger, bytes: file.length } });
    })();
    pruneLocal(ctx, opts.dir);
    return { backupId, fileName, manifest };
  } catch (e) {
    rmSync(`${finalPath}.part`, { force: true });
    rmSync(finalPath, { force: true });
    ctx.db
      .prepare("INSERT INTO backup_jobs (created_at, trigger, user_id, status, error) VALUES (?, ?, ?, 'failed', ?)")
      .run(createdAt, opts.trigger, opts.userId, (e as Error).message.slice(0, 500));
    throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Encrypted copy of a database taken before a schema migration (plan §J). Not recorded in backup_jobs,
 * because that table may not exist yet in an old schema. Returns the file path.
 */
export function encryptedSnapshot(db: Database.Database, dir: string, masterKey: Buffer, appVersion: string, label: string): string {
  mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const backupId = `${createdAt.replace(/[-:]/g, '').replace(/\..*/, '')}-${label}`;
  const tmp = join(dir, `.tmp-${backupId}.db`);
  const out = join(dir, `pos-${backupId}.posbak`);
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    const { file } = encryptBackup(readFileSync(tmp), masterKey, { backupId, createdAt, appVersion, ...inspectSnapshot(tmp) });
    writeFileSync(`${out}.part`, file);
    renameSync(`${out}.part`, out);
    decryptBackup(readFileSync(out), masterKey);
    return out;
  } finally {
    rmSync(tmp, { force: true });
    rmSync(`${out}.part`, { force: true });
  }
}

/** Keeps the newest KEEP_LOCAL verified files; older ones are deleted and marked pruned. */
export function pruneLocal(ctx: Ctx, dir: string, keep = KEEP_LOCAL): number {
  const old = ctx.db
    .prepare("SELECT id, file_name FROM backup_jobs WHERE status = 'verified_local' ORDER BY id DESC LIMIT -1 OFFSET ?")
    .all(keep) as { id: number; file_name: string }[];
  for (const r of old) {
    rmSync(join(dir, r.file_name), { force: true });
    ctx.db.prepare("UPDATE backup_jobs SET status = 'pruned' WHERE id = ?").run(r.id);
  }
  return old.length;
}

export function backupStatus(ctx: Ctx): BackupStatus {
  const ok = ctx.db.prepare("SELECT created_at, file_name, size_bytes FROM backup_jobs WHERE status = 'verified_local' ORDER BY id DESC LIMIT 1").get() as
    | { created_at: string; file_name: string; size_bytes: number }
    | undefined;
  const fail = ctx.db.prepare("SELECT created_at, error FROM backup_jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 1").get() as
    | { created_at: string; error: string }
    | undefined;
  return {
    lastVerifiedLocal: ok ? { at: ok.created_at, fileName: ok.file_name, sizeBytes: ok.size_bytes } : null,
    lastFailure: fail && (!ok || fail.created_at > ok.created_at) ? { at: fail.created_at, error: fail.error } : null,
    offsite: 'not_configured',
  };
}

export function listBackupFiles(dir: string): { fileName: string; sizeBytes: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.posbak'))
    .sort()
    .reverse()
    .map((f) => ({ fileName: f, sizeBytes: statSync(join(dir, f)).size }));
}

/**
 * Step 1 of restore: decrypt, verify checksum and integrity, and report what the backup contains.
 * Writes the database to `stagingPath`. Does not touch the live database.
 */
export function prepareRestore(backupFile: string, masterKey: Buffer, stagingPath: string): BackupManifest & { verifiedCounts: Record<string, number> } {
  const { plain, manifest } = decryptBackup(readFileSync(backupFile), masterKey);
  rmSync(stagingPath, { force: true });
  writeFileSync(stagingPath, plain);
  const facts = inspectSnapshot(stagingPath);
  for (const [t, n] of Object.entries(manifest.counts)) {
    if (facts.counts[t] !== n) throw new Error(`Restored ${t} count ${facts.counts[t]} does not match backup record ${n}`);
  }
  return { ...manifest, verifiedCounts: facts.counts };
}

/**
 * Step 2 of restore (the live database must be CLOSED first).
 * The current database files are moved aside, never deleted.
 */
export function installRestore(livePath: string, stagingPath: string, stamp: string): string {
  const aside = `${livePath}.before-restore-${stamp}`;
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(livePath + suffix)) renameSync(livePath + suffix, aside + suffix);
  }
  renameSync(stagingPath, livePath);
  return aside;
}
