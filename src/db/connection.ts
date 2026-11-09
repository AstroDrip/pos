import Database from 'better-sqlite3';
import { normalizeForSearch } from '../core/search-normalize';
import { backfillSupplierAllocations } from '../services/purchasing';
import { ensureSearchIndex } from '../services/search';
import { migrate, pendingMigrations } from './migrations';

export type Db = Database.Database;

/**
 * SQLite versions known to be unsafe for this app (plan §L-3, §L-6):
 *  - < 3.51.3: WAL-reset corruption bug (sqlite.org/wal.html)
 *  - 3.52.0: flagged by the SQLite team
 */
export function checkSqliteVersion(version: string): void {
  const [a = 0, b = 0, c = 0] = version.split('.').map(Number);
  const n = a * 1_000_000 + b * 1_000 + c;
  if (n < 3_051_003) throw new Error(`SQLite ${version} is too old (need >= 3.51.3)`);
  if (a === 3 && b === 52 && c === 0) throw new Error('SQLite 3.52.0 is blocked');
}

export interface OpenOptions {
  /**
   * Called before migrating an existing database, to save a copy of it. The default writes a plain
   * SQLite copy next to the database; the app passes an encrypting version once a backup key exists.
   */
  preMigrationSnapshot?: (db: Db, firstPendingVersion: number) => void;
}

/**
 * Opens the single application connection. Only the Electron main process calls this;
 * all reads and writes go through this one connection (plan §E).
 */
export function openDatabase(path: string, opts: OpenOptions = {}): Db {
  const db = new Database(path);
  checkSqliteVersion((db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL'); // survive power loss at the till, at a small speed cost
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.function('pos_norm', { deterministic: true }, (s: unknown) => normalizeForSearch(String(s ?? ''))); // Arabic spelling variants in name searches
  // Plan §J: snapshot an existing database before changing its schema.
  const pending = pendingMigrations(db);
  if (pending.length > 0) {
    if (opts.preMigrationSnapshot) opts.preMigrationSnapshot(db, pending[0]!);
    else db.prepare('VACUUM INTO ?').run(`${path}.pre-v${pending[0]}-${Date.now()}.db`);
  }
  migrate(db);
  ensureSearchIndex({ db, now: () => new Date().toISOString(), uuid: () => '' });
  backfillSupplierAllocations({ db, now: () => new Date().toISOString(), uuid: () => '' }); // one-time, after migration 10
  const fk = db.pragma('foreign_key_check') as unknown[];
  if (fk.length > 0) throw new Error(`Foreign key violations found at startup: ${fk.length}`);
  return db;
}
