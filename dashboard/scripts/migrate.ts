// npm run db:migrate. Runs from your own computer with the owner connection. Never run on Vercel.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureRoles, migrate } from '../src/server/migrate-core.ts';
import { neonDb } from '../src/server/neon-db.ts';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} first. See .env.example.`);
    process.exit(1);
  }
  return v;
};

const db = neonDb(need('DATABASE_URL_UNPOOLED'));
await ensureRoles(db, { dashboard_app: need('DASHBOARD_APP_PASSWORD'), dashboard_demo: need('DASHBOARD_DEMO_PASSWORD'), device_api: need('DEVICE_API_PASSWORD') });
const dir = join(import.meta.dirname, '..', 'migrations');
const ran = await migrate(db, readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })));
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Already up to date.');
console.log('Roles ready: dashboard_app, dashboard_demo, device_api.');
