import { neon } from '@neondatabase/serverless';
import type { Db, Statement } from './db-types.ts';

/** Neon over HTTP: no pool to exhaust on serverless functions. */
export function neonDb(url: string): Db {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
    async batch(statements: Statement[]) {
      await sql.transaction((tx) => statements.map((s) => tx.query(s.text, s.params ?? [])));
    },
  };
}
