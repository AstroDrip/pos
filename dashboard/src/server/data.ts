import 'server-only';
import { cache } from 'react';
import { freshness, type Freshness } from '../lib/freshness.ts';
import { riyadhToday } from '../lib/period.ts';
import type { CreditSnapshot, DaySnapshot, PositionSnapshot, ShiftSnapshot, StockSnapshot } from '../shared/snapshots.ts';
import type { Scope, SessionUser } from './auth-core.ts';
import type { Db } from './db-types.ts';
import { dbFor } from './db.ts';

// Reads only. The schema is chosen by the session's scope from these two fixed names, never from input.
const SCHEMA: Record<Scope, string> = { real: 'readmodel', demo: 'demo' };

export interface StoreStatus {
  storeName: string;
  deviceName: string | null;
  appVersion: string | null;
  lastSuccessAt: string | null;
  lastDataAt: string | null;
  today: string;
  freshness: Freshness;
  demo: boolean;
}

function connection(scope: Scope): Db {
  const db = dbFor(scope);
  if (!db) throw new Error('This dashboard has no database for this login.');
  return db;
}

const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());

export const loadStatus = cache(async (u: SessionUser): Promise<StoreStatus> => {
  const [r] = await connection(u.scope).query<Record<string, unknown>>(`SELECT * FROM ${SCHEMA[u.scope]}.status WHERE store_id = $1`, [u.storeId]);
  const demo = u.scope === 'demo';
  const lastSuccessAt = iso(r?.last_success_at);
  return {
    storeName: (r?.store_name as string | undefined) ?? 'Store',
    deviceName: (r?.device_name as string | null | undefined) ?? null,
    appVersion: (r?.app_version as string | null | undefined) ?? null,
    lastSuccessAt,
    lastDataAt: iso(r?.last_data_at),
    today: demo && r?.today ? (r.today as string) : riyadhToday(),
    freshness: freshness(lastSuccessAt, new Date(), demo),
    demo,
  };
});

export async function loadDays(u: SessionUser, from: string, to: string): Promise<DaySnapshot[]> {
  const rows = await connection(u.scope).query<{ payload: DaySnapshot }>(`SELECT payload FROM ${SCHEMA[u.scope]}.snapshots WHERE store_id = $1 AND kind = 'day' AND snap_key BETWEEN $2 AND $3 ORDER BY snap_key`, [u.storeId, from, to]);
  return rows.map((r) => r.payload);
}

async function single<T>(u: SessionUser, kind: string): Promise<(T & { receivedAt: string }) | null> {
  const [r] = await connection(u.scope).query<{ payload: T; received_at: string }>(`SELECT payload, received_at FROM ${SCHEMA[u.scope]}.snapshots WHERE store_id = $1 AND kind = $2 AND snap_key = 'current'`, [u.storeId, kind]);
  return r ? { ...r.payload, receivedAt: iso(r.received_at)! } : null;
}

export const loadPosition = cache((u: SessionUser) => single<PositionSnapshot>(u, 'position'));
export const loadStock = (u: SessionUser) => single<StockSnapshot>(u, 'stock');
export const loadCredit = (u: SessionUser) => single<CreditSnapshot>(u, 'credit');
export const loadShift = (u: SessionUser) => single<ShiftSnapshot>(u, 'shift');
