import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import * as m001 from './migrations/001_initial';
import * as m002 from './migrations/002_backups';
import * as m003 from './migrations/003_suspense_and_voids';
import * as m004 from './migrations/004_search_and_safety';
import * as m005 from './migrations/005_refunds_and_stock_adjustments';
import * as m006 from './migrations/006_scale_layouts';
import * as m007 from './migrations/007_expenses';
import * as m008 from './migrations/008_dashboard_outbox';
import * as m009 from './migrations/009_purchasing';
import * as m010 from './migrations/010_credit';
import * as m011 from './migrations/011_supplier_bills';
import * as m012 from './migrations/012_bill_drafts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Append only. Never edit a migration after it has shipped: the checksum check will refuse to start.
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: m001.sql },
  { version: 2, name: 'backups', sql: m002.sql },
  { version: 3, name: 'suspense_and_voids', sql: m003.sql },
  { version: 4, name: 'search_and_safety', sql: m004.sql },
  { version: 5, name: 'refunds_and_stock_adjustments', sql: m005.sql },
  { version: 6, name: 'scale_layouts', sql: m006.sql },
  { version: 7, name: 'expenses', sql: m007.sql },
  { version: 8, name: 'dashboard_outbox', sql: m008.sql },
  { version: 9, name: 'purchasing', sql: m009.sql },
  { version: 10, name: 'credit', sql: m010.sql },
  { version: 11, name: 'supplier_bills', sql: m011.sql },
  { version: 12, name: 'bill_drafts', sql: m012.sql },
];

/** Versions not yet applied to this database (empty for a brand-new file before migrate()). */
export function pendingMigrations(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!hasTable) return [];
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  return migrations.filter((m) => !done.has(m.version)).map((m) => m.version);
}

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

export class MigrationError extends Error {}

/** Applies pending migrations, each in its own transaction. Returns the versions applied. */
export function migrate(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as {
    version: number;
    checksum: string;
  }[];
  const latestKnown = migrations.at(-1)?.version ?? 0;

  for (const row of applied) {
    if (row.version > latestKnown) {
      throw new MigrationError(`Database schema v${row.version} is newer than this app (v${latestKnown}). Update the app.`);
    }
    const m = migrations.find((x) => x.version === row.version);
    if (!m || checksum(m.sql) !== row.checksum) {
      throw new MigrationError(`Migration v${row.version} has been altered after it was applied.`);
    }
  }

  const done = new Set(applied.map((r) => r.version));
  const ran: number[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        m.version,
        m.name,
        checksum(m.sql),
        new Date().toISOString(),
      );
    })();
    ran.push(m.version);
  }
  return ran;
}
