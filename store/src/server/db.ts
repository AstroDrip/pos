import 'server-only';
import { neonConfig } from '@neondatabase/serverless';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
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

export function appDb(): Db | null {
  const url = readEnv().appUrl;
  return url ? get(url) : null;
}

export function deviceDb(): Db | null {
  const url = readEnv().deviceUrl;
  return url ? get(url) : null;
}
