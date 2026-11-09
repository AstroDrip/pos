import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Statement } from '../src/server/db-types.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../src/server/migrate-core.ts';

const dir = join(__dirname, '..', 'migrations');
export const migrationFiles = () => readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));

// PGlite returns one connection, so each call sets the role it should run as.
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
  demo: Db;
  device: Db;
}

export async function makeCloud(): Promise<TestCloud> {
  const pg = new PGlite();
  const owner = asRole(pg, null);
  await ensureRoles(owner, Object.fromEntries(ROLES.map((r) => [r, 'test-only-password-1234'])) as Record<RoleName, string>);
  await migrate(owner, migrationFiles());
  return { pg, owner, app: asRole(pg, 'dashboard_app'), demo: asRole(pg, 'dashboard_demo'), device: asRole(pg, 'device_api') };
}

export const STORE = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';

export async function addStore(c: TestCloud, id = STORE, name = 'Made Up Grocery') {
  await c.owner.query('INSERT INTO cloud.stores (id, name) VALUES ($1, $2)', [id, name]);
}

export async function addCode(c: TestCloud, code: string, id = STORE) {
  const { createHash } = await import('node:crypto');
  await c.owner.query("INSERT INTO cloud.enrollment_codes (code_hash, store_id, expires_at) VALUES ($1, $2, now() + interval '1 day')", [createHash('sha256').update(code).digest('hex'), id]);
}
