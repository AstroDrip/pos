// npm run store:create -- "Store name". Prints a one-time code that links the POS to this store.
import { createHash, randomBytes } from 'node:crypto';
import { neonDb } from '../src/server/neon-db.ts';

const url = process.env.DATABASE_URL_UNPOOLED;
const name = process.argv[2]?.trim();
if (!url || !name) {
  console.error('Usage: set DATABASE_URL_UNPOOLED, then npm run store:create -- "Store name"');
  process.exit(1);
}
const db = neonDb(url);
const [existing] = await db.query<{ id: string }>('SELECT id FROM cloud.stores WHERE name = $1', [name]);
const id = existing?.id ?? (await db.query<{ id: string }>('INSERT INTO cloud.stores (name) VALUES ($1) RETURNING id', [name]))[0]!.id;
const code = randomBytes(15).toString('base64url');
await db.query("INSERT INTO cloud.enrollment_codes (code_hash, store_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", [createHash('sha256').update(code).digest('hex'), id]);
console.log(`Store id:          ${id}`);
console.log(`One-time POS code: ${code}`);
console.log('The code works once and expires in 7 days. It is not shown again.');
