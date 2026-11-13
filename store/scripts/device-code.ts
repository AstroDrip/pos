// npm run device:code. Makes a one-time code the POS uses to connect. It works for 7 days. Only its hash is stored.
import { createHash, randomBytes } from 'node:crypto';
import { neonDb } from '../src/server/neon-db.ts';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error('Set DATABASE_URL_UNPOOLED first. See .env.example.');
  process.exit(1);
}
const code = randomBytes(15).toString('base64url');
await neonDb(url).query("INSERT INTO commerce.enrollment_codes (code_hash, expires_at) VALUES ($1, now() + interval '7 days')", [createHash('sha256').update(code).digest('hex')]);
console.log(`One-time code: ${code}`);
