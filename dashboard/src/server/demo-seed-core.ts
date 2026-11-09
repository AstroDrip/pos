import type { Statement } from './db-types.ts';

export const DEMO_STORE_ID = '00000000-0000-4000-8000-00000000d3e0';

export interface DemoFile {
  storeName: string;
  today: string;
  generatedAt: string;
  events: { kind: string; snapKey: string; createdAt: string; payload: unknown }[];
}

/** Writes only to the demo schema and to the one demo login. The real schema is never named here. */
export function demoSeedStatements(file: DemoFile, passwordHash: string): Statement[] {
  const out: Statement[] = [
    { text: 'DELETE FROM demo.snapshots' },
    { text: 'DELETE FROM demo.status' },
    {
      text: `INSERT INTO dash_auth.users (username, password_hash, display_name, scope, store_id) VALUES ('demo', $1, 'Demo owner', 'demo', $2)
             ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, active = true WHERE dash_auth.users.scope = 'demo'`,
      params: [passwordHash, DEMO_STORE_ID],
    },
    {
      text: 'INSERT INTO demo.status (store_id, store_name, device_name, app_version, last_success_at, last_data_at, today) VALUES ($1, $2, $3, $4, $5, $5, $6)',
      params: [DEMO_STORE_ID, file.storeName, 'Demo till', 'demo', file.generatedAt, file.today],
    },
  ];
  for (const e of file.events) {
    out.push({ text: 'INSERT INTO demo.snapshots (store_id, kind, snap_key, version, payload, source_created_at) VALUES ($1, $2, $3, 1, $4, $5)', params: [DEMO_STORE_ID, e.kind, e.snapKey, JSON.stringify(e.payload), e.createdAt] });
  }
  return out;
}
