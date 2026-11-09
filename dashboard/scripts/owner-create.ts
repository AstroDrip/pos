// npm run owner:create. Creates the owner's real login, or changes its password.
import { neonDb } from '../src/server/neon-db.ts';
import { hashPassword } from '../src/server/password.ts';

const { DATABASE_URL_UNPOOLED: url, OWNER_USERNAME: username, OWNER_PASSWORD: password, STORE_ID: storeId } = process.env;
if (!url || !username || !password || !storeId) {
  console.error('Set DATABASE_URL_UNPOOLED, OWNER_USERNAME, OWNER_PASSWORD and STORE_ID first. See .env.example.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}
const db = neonDb(url);
const name = username.trim().toLowerCase();
await db.query(
  `INSERT INTO dash_auth.users (username, password_hash, display_name, scope, store_id) VALUES ($1, $2, 'Owner', 'real', $3)
   ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, store_id = excluded.store_id, active = true WHERE dash_auth.users.scope = 'real'`,
  [name, await hashPassword(password), storeId],
);
console.log(`Owner login "${name}" is ready.`);
