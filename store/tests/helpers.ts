import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../../dashboard/src/server/password.ts';
import type { Db, Statement } from '../../dashboard/src/server/db-types.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../src/server/migrate-core.ts';

const dir = join(__dirname, '..', 'migrations');
export const migrationFiles = () => readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));

// PGlite is one connection, so each call sets the role it runs as. It cannot prove row locks: see the concurrency tests in Phase E1.
function asRole(pg: PGlite, role: string | null): Db {
  const set = role ? `SET ROLE ${role}` : 'RESET ROLE';
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return pg.transaction(async (tx) => {
        await tx.exec(set);
        const r = await tx.query<T>(text, params as never[]);
        await tx.exec('RESET ROLE');
        return r.rows;
      }) as Promise<T[]>;
    },
    async batch(statements: Statement[]) {
      await pg.transaction(async (tx) => {
        await tx.exec(set);
        for (const s of statements) await tx.query(s.text, (s.params ?? []) as never[]);
        await tx.exec('RESET ROLE');
      });
    },
  };
}

export interface TestCloud {
  pg: PGlite;
  owner: Db;
  app: Db;
  device: Db;
}

// Migrating from empty is the slow part, so each test worker does it once and every test starts from a copy.
let template: Promise<File | Blob> | null = null;
function migratedTemplate(): Promise<File | Blob> {
  template ??= (async () => {
    const pg = new PGlite();
    const owner = asRole(pg, null);
    await ensureRoles(owner, Object.fromEntries(ROLES.map((r) => [r, 'test-only-password-1234'])) as Record<RoleName, string>);
    await migrate(owner, migrationFiles());
    const dump = await pg.dumpDataDir('none');
    await pg.close();
    return dump;
  })();
  return template;
}

export async function makeCloud(): Promise<TestCloud> {
  const pg = new PGlite({ loadDataDir: await migratedTemplate() });
  return { pg, owner: asRole(pg, null), app: asRole(pg, 'store_app'), device: asRole(pg, 'store_device') };
}

export const TEST_PASSWORD = 'made-up-test-password';

export async function addStaff(c: TestCloud, username: string, role: 'admin' | 'supervisor' | 'cashier', active = true): Promise<number> {
  const [r] = await c.owner.query<{ id: number | string }>('INSERT INTO commerce.staff_users (username, display_name, password_hash, role, active) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, `Test ${username}`, await hashPassword(TEST_PASSWORD), role, active]);
  return Number(r!.id);
}

export async function addCode(c: TestCloud, code: string, expiresSql = "now() + interval '1 day'") {
  await c.owner.query(`INSERT INTO commerce.enrollment_codes (code_hash, expires_at) VALUES ($1, ${expiresSql})`, [createHash('sha256').update(code).digest('hex')]);
}
