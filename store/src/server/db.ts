import 'server-only';
import { neonConfig } from '@neondatabase/serverless';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { demoAppDb } from './demo/demo-db.ts';
import { readEnv } from './env.ts';
import { neonDb } from './neon-db.ts';

// Local testing only: points the real driver at scripts/dev-sql-server.ts. Ignored in production.
if (process.env.NODE_ENV !== 'production' && process.env.NEON_LOCAL_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_LOCAL_ENDPOINT;
}

const cache = new Map<string, Db>();
const get = (url: string) => {
  let db = cache.get(url);
  if (!db) cache.set(url, (db = neonDb(url)));
  return db;
};

// Pages and API routes are built as separate bundles, so a plain module variable would give each its own demo
// database. One copy per server process is kept on globalThis instead.
const shared = globalThis as typeof globalThis & { __storeDemoDb?: Db };

export function appDb(): Db | null {
  const env = readEnv();
  if (env.appUrl) return get(env.appUrl);
  if (env.demo) return (shared.__storeDemoDb ??= demoAppDb(env.demoPassword));
  return null;
}

export function deviceDb(): Db | null {
  const url = readEnv().deviceUrl;
  return url ? get(url) : null;
}
