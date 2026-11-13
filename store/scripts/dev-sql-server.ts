// Local testing only: an in-memory Postgres that answers the Neon driver's HTTP calls, so the app can be tried with no account.
// Each request runs as the role named in its connection string, so the real permissions apply. All data is made up and vanishes on exit.
//   npm run dev:sql
//   then run the app with NEON_LOCAL_ENDPOINT=http://localhost:4445/sql,
//   STORE_APP_DATABASE_URL=postgresql://store_app:x@local.test/neondb and STORE_DEVICE_DATABASE_URL=postgresql://store_device:x@local.test/neondb
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../../dashboard/src/server/password.ts';
import type { Db, Statement } from '../../dashboard/src/server/db-types.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../src/server/migrate-core.ts';
import { seedDemoShop } from './demo-shop-data.ts';

const pg = new PGlite();
const owner: Db = {
  async query<T>(text: string, params: unknown[] = []) {
    return (await pg.query<T>(text, params as never[])).rows;
  },
  async batch(statements: Statement[]) {
    await pg.transaction(async (tx) => {
      for (const s of statements) await tx.query(s.text, (s.params ?? []) as never[]);
    });
  },
};

await ensureRoles(owner, Object.fromEntries(ROLES.map((r) => [r, randomBytes(16).toString('hex')])) as Record<RoleName, string>);
const dir = join(import.meta.dirname, '..', 'migrations');
await migrate(owner, readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })));

// A fresh random password each run, shown only in this window.
for (const [username, role] of [['localadmin', 'admin'], ['localcashier', 'cashier']] as const) {
  const password = randomBytes(12).toString('base64url');
  await owner.query('INSERT INTO commerce.staff_users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)', [username, `Local ${role}`, await hashPassword(password), role]);
  console.log(`staff ${username} ${password}`);
}

await seedDemoShop(owner);
const code = randomBytes(15).toString('base64url');
await owner.query("INSERT INTO commerce.enrollment_codes (code_hash, expires_at) VALUES ($1, now() + interval '7 days')", [createHash('sha256').update(code).digest('hex')]);
console.log(`code ${code}`);
// Stands in for the POS: keeps the stock numbers counted as fresh.
setInterval(() => void owner.query('UPDATE commerce.devices SET last_seen_at = now()'), 30_000);

const param = (v: unknown) => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (typeof v === 'string' && /^\{\d+(,\d+)*\}$/.test(v)) return v.slice(1, -1).split(',').map(Number);
  return v;
};
const text = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '+00'); // the text form Postgres itself sends
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/["\\]/g, '\\$&')}"`).join(',')}}`; // the text form Postgres sends for arrays
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

type Q = { query: string; params?: unknown[] };
type Tx = Pick<PGlite, 'query'>;

async function run(tx: Tx, q: Q) {
  const r = await tx.query<Record<string, unknown>>(q.query, (q.params ?? []).map(param) as never[], { rowMode: 'array' as never });
  return { command: 'SELECT', rowCount: r.rows.length, rowAsArray: true, fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })), rows: (r.rows as unknown as unknown[][]).map((row) => row.map(text)) };
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    res.setHeader('content-type', 'application/json');
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Q & { queries?: Q[] };
      const role = new URL(String(req.headers['neon-connection-string'])).username;
      if (!(ROLES as readonly string[]).includes(role)) throw new Error('unknown role');
      const out = await pg.transaction(async (tx) => {
        await tx.exec(`SET ROLE ${role}`);
        let result: unknown;
        if (body.queries) {
          const results: unknown[] = [];
          for (const q of body.queries) results.push(await run(tx, q));
          result = { results };
        } else {
          result = await run(tx, body);
        }
        await tx.exec('RESET ROLE');
        return result;
      });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: (e as Error).message, code: '42501' }));
    }
  });
}).listen(4445, () => console.log('ready on 4445'));
