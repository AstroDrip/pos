// npm run db:migrate. Runs from your own computer with the owner connection. Never run on the host.
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
await ensureRoles(db, { store_app: need('STORE_APP_PASSWORD'), store_device: need('STORE_DEVICE_PASSWORD') });
const dir = join(import.meta.dirname, '..', 'migrations');
const ran = await migrate(db, readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })));
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Already up to date.');
