// npm run demo:seed. Loads the made-up shop into the demo schema only. Run it again to reload it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neonDb } from '../src/server/neon-db.ts';
import { demoSeedStatements, type DemoFile } from '../src/server/demo-seed-core.ts';
import { hashPassword } from '../src/server/password.ts';

const { DATABASE_URL_UNPOOLED: url, DEMO_ADMIN_PASSWORD: password } = process.env;
if (!url || !password) {
  console.error('Set DATABASE_URL_UNPOOLED and DEMO_ADMIN_PASSWORD first. See .env.example.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use a password of at least 12 characters, and not one you use anywhere else.');
  process.exit(1);
}
const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'seed', 'demo-snapshots.json'), 'utf8')) as DemoFile;
const db = neonDb(url);
const statements = demoSeedStatements(file, await hashPassword(password));
// Neon's HTTP endpoint limits one request, so large seeds go in slices. The first slice clears the old demo.
for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
console.log(`Demo data loaded: ${file.events.length} records. Log in as "demo". Demo day: ${file.today}.`);
