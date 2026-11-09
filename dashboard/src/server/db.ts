import 'server-only';
import { neonConfig } from '@neondatabase/serverless';
import type { Scope } from './auth-core.ts';
import type { Db } from './db-types.ts';
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

/** The connection for one scope. Demo never falls back to real, and real never falls back to demo. */
export function dbFor(scope: Scope): Db | null {
  const env = readEnv();
  const url = scope === 'demo' ? env.demoUrl : env.realUrl;
  return url ? get(url) : null;
}

export function deviceDb(): Db | null {
  const url = readEnv().deviceUrl;
  return url ? get(url) : null;
}

export const demoModeOn = () => readEnv().demoMode;
