// Local testing only: an in-memory Postgres that answers the Neon driver's HTTP calls, so the app can be tried with no account.
// Each request runs as the role named in its connection string, so the real permissions apply.
//   DEMO_ADMIN_PASSWORD=... node scripts/dev-sql-server.ts
//   then in another window: NEON_LOCAL_ENDPOINT=http://localhost:4444/sql with the .env.local below, and npm run dev
// DASHBOARD_DEMO_MODE=true, DASHBOARD_DEMO_DATABASE_URL=postgresql://dashboard_demo:x@local.test/neondb
// DASHBOARD_DATABASE_URL=postgresql://dashboard_app:x@local.test/neondb, DEVICE_API_DATABASE_URL=postgresql://device_api:x@local.test/neondb
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Statement } from '../src/server/db-types.ts';
import { demoSeedStatements, type DemoFile } from '../src/server/demo-seed-core.ts';
import { ensureRoles, migrate, ROLES, type RoleName } from '../src/server/migrate-core.ts';
import { hashPassword } from '../src/server/password.ts';

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

await ensureRoles(owner, Object.fromEntries(ROLES.map((r) => [r, 'local-test-password-1234'])) as Record<RoleName, string>);
const dir = join(import.meta.dirname, '..', 'migrations');
await migrate(owner, readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })));
const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'seed', 'demo-snapshots.json'), 'utf8')) as DemoFile;
await owner.batch(demoSeedStatements(file, await hashPassword(process.env.DEMO_ADMIN_PASSWORD ?? 'local-demo-password')));
const [store] = await owner.query<{ id: string }>("INSERT INTO cloud.stores (name) VALUES ('Local test store') RETURNING id");
const code = randomBytes(15).toString('base64url');
await owner.query("INSERT INTO cloud.enrollment_codes (code_hash, store_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", [createHash('sha256').update(code).digest('hex'), store!.id]);
console.log(`store ${store!.id}`);
console.log(`code ${code}`);

const param = (v: unknown) => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (typeof v === 'string' && /^\{("[^"]*"(,"[^"]*")*)?\}$/.test(v)) return v === '{}' ? [] : v.slice(2, -2).split('","');
  return v;
};
const text = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '+00'); // the text form Postgres itself sends
  if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString('hex')}`;
  if (typeof v === 'boolean') return v ? 't' : 'f';
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
        const result = body.queries ? { results: await Promise.all(body.queries.reduce<Promise<unknown>[]>((acc, q) => [...acc, (acc.at(-1) ?? Promise.resolve()).then(() => run(tx, q))], [])) } : await run(tx, body);
        await tx.exec('RESET ROLE');
        return result;
      });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: (e as Error).message, code: '42501' }));
    }
  });
}).listen(4444, () => console.log('ready on 4444'));
