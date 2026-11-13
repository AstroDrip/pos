// npm run staff:create. Adds a staff login, using the owner connection and the STAFF_ settings. See .env.example.
import { hashPassword } from '../../dashboard/src/server/password.ts';
import { neonDb } from '../src/server/neon-db.ts';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} first. See .env.example.`);
    process.exit(1);
  }
  return v;
};

const password = need('STAFF_PASSWORD');
if (password.length < 12) {
  console.error('STAFF_PASSWORD must be at least 12 characters.');
  process.exit(1);
}
const username = need('STAFF_USERNAME').trim().toLowerCase();
const db = neonDb(need('DATABASE_URL_UNPOOLED'));
await db.query('INSERT INTO commerce.staff_users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)', [username, need('STAFF_DISPLAY_NAME'), await hashPassword(password), need('STAFF_ROLE')]);
console.log(`Staff login created: ${username}`);
