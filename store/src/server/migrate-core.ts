import { createHash } from 'node:crypto';
import type { Db } from '../../../dashboard/src/server/db-types.ts';

export interface MigrationFile {
  name: string;
  sql: string;
}

export const ROLES = ['store_app', 'store_device'] as const;
export type RoleName = (typeof ROLES)[number];

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** A semicolon at a line end closes a statement, unless it is inside a $$ function body. */
export function splitStatements(sql: string): string[] {
  const text = sql.replace(/^\s*--.*$/gm, '');
  const parts: string[] = [];
  let start = 0;
  let inBody = false;
  for (const m of text.matchAll(/\$\$|;\s*(?:\r?\n|$)/g)) {
    if (m[0] === '$$') inBody = !inBody;
    else if (!inBody) {
      parts.push(text.slice(start, m.index));
      start = m.index + m[0].length;
    }
  }
  parts.push(text.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Creates the login roles, or updates their passwords when run again. */
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
  await db.query('CREATE TABLE IF NOT EXISTS public.store_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Map((await db.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM public.store_migrations')).map((r) => [r.name, r.sha256]));
  const ran: string[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sha = createHash('sha256').update(f.sql).digest('hex');
    const seen = done.get(f.name);
    if (seen === sha) continue;
    if (seen) throw new Error(`Migration ${f.name} was changed after it was applied`);
    await db.batch([...splitStatements(f.sql).map((text) => ({ text })), { text: 'INSERT INTO public.store_migrations (name, sha256) VALUES ($1, $2)', params: [f.name, sha] }]);
    ran.push(f.name);
  }
  return ran;
}
