import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestCtx } from '../services/test-helpers';
import { checkSqliteVersion } from './connection';
import { MIGRATIONS, MigrationError, migrate } from './migrations';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('migrations', () => {
  it('applies cleanly and is idempotent', () => {
    const db = new Database(':memory:');
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('refuses a migration that was edited after being applied', () => {
    const db = new Database(':memory:');
    migrate(db);
    const tampered = MIGRATIONS.map((m) => ({ ...m, sql: m.sql + '\n-- edited' }));
    expect(() => migrate(db, tampered)).toThrow(MigrationError);
  });

  it('refuses a database created by a newer app version', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare("INSERT INTO schema_migrations VALUES (999, 'future', 'x', 'now')").run();
    expect(() => migrate(db)).toThrow(/newer than this app/);
  });

  it('opens a real WAL database with foreign keys on', () => {
    const t = makeTestCtx();
    cleanup = t.cleanup;
    expect(t.ctx.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.ctx.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('checkSqliteVersion', () => {
  it('blocks versions with known corruption bugs', () => {
    expect(() => checkSqliteVersion('3.51.2')).toThrow();
    expect(() => checkSqliteVersion('3.52.0')).toThrow();
    expect(() => checkSqliteVersion('3.51.3')).not.toThrow();
    expect(() => checkSqliteVersion('3.53.4')).not.toThrow();
  });
});
