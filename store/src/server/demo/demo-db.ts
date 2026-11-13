import { PGlite } from '@electric-sql/pglite';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../../../dashboard/src/server/password.ts';
import type { Db, Statement } from '../../../../dashboard/src/server/db-types.ts';
import { seedDemoShop } from '../../../scripts/demo-shop-data.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../migrate-core.ts';
import { MIGRATIONS } from './migrations.generated.ts';

/**
 * A throwaway database inside the server process, filled with made-up shop data, for looking at the design without
 * any real database. Each server instance has its own copy, and it is lost when the instance stops, so orders and
 * sign-ins in the demo can disappear. Never used when a real database is set (see readEnv).
 */

// PGlite is one connection, so each call sets the role it runs as, like the real app's limited database account.
function asRole(pg: PGlite, role: RoleName | null): Db {
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

export const DEMO_USERNAME = 'demo';

export async function startDemo(password: string | null): Promise<{ owner: Db; app: Db }> {
  const pg = new PGlite();
  const owner = asRole(pg, null);
  // The role passwords are never used: nothing connects to this database from outside.
  await ensureRoles(owner, Object.fromEntries(ROLES.map((r) => [r, randomBytes(16).toString('hex')])) as Record<RoleName, string>);
  await migrate(owner, MIGRATIONS);
  await seedDemoShop(owner);
  if (password) {
    await owner.query('INSERT INTO commerce.staff_users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)', [DEMO_USERNAME, 'Demo owner', await hashPassword(password), 'admin']);
  }
  return { owner, app: asRole(pg, 'store_app') };
}

/** The app's view of the demo database. It starts on first use, and the made-up till is kept counted as connected. */
export function demoAppDb(password: string | null): Db {
  let started: ReturnType<typeof startDemo> | null = null;
  let lastBeat = 0;
  const ready = async () => {
    started ??= startDemo(password).catch((e: unknown) => {
      started = null; // try again on the next request
      throw e;
    });
    const db = await started;
    if (Date.now() - lastBeat > 60_000) {
      lastBeat = Date.now();
      await db.owner.query('UPDATE commerce.devices SET last_seen_at = now(), last_contact_at = now()');
    }
    return db.app;
  };
  return {
    async query<T>(text: string, params?: unknown[]) {
      return (await ready()).query<T>(text, params);
    },
    async batch(statements: Statement[]) {
      await (await ready()).batch(statements);
    },
  };
}
