import { createHash } from 'node:crypto';
import type { Db } from './db-types.ts';

export interface MigrationFile {
  name: string;
  sql: string;
}

export const ROLES = ['dashboard_app', 'dashboard_demo', 'device_api'] as const;
export type RoleName = (typeof ROLES)[number];

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** These files have no function bodies, so a semicolon at a line end always closes a statement. */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Creates the three login roles, or updates their passwords when run again. */
export async function ensureRoles(db: Db, passwords: Record<RoleName, string>): Promise<void> {
  const have = new Set((await db.query<{ rolname: string }>('SELECT rolname FROM pg_roles')).map((r) => r.rolname));
  for (const role of ROLES) {
    const pw = passwords[role];
    if (pw.length < 16) throw new Error(`The password for ${role} must be at least 16 characters`);
    await db.query(`${have.has(role) ? 'ALTER' : 'CREATE'} ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quote(pw)}`);
  }
}

/** Applies unapplied files in order, each in one transaction. A changed file stops the run. */
export async function migrate(db: Db, files: MigrationFile[]): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS public.dashboard_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Map((await db.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM public.dashboard_migrations')).map((r) => [r.name, r.sha256]));
  const ran: string[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sha = createHash('sha256').update(f.sql).digest('hex');
    const seen = done.get(f.name);
    if (seen === sha) continue;
    if (seen) throw new Error(`Migration ${f.name} was changed after it was applied`);
    await db.batch([...splitStatements(f.sql).map((text) => ({ text })), { text: 'INSERT INTO public.dashboard_migrations (name, sha256) VALUES ($1, $2)', params: [f.name, sha] }]);
    ran.push(f.name);
  }
  return ran;
}
