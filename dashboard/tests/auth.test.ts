import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptLogin, MAX_FAILURES, readSession, revokeAllSessions, revokeSession } from '../src/server/auth-core.ts';
import { hashPassword } from '../src/server/password.ts';
import { makeCloud, STORE, type TestCloud } from './helpers.ts';

let c: TestCloud;
const PW = 'a-long-made-up-password';

beforeEach(async () => {
  c = await makeCloud();
  const hash = await hashPassword(PW);
  await c.owner.query("INSERT INTO dash_auth.users (username, password_hash, display_name, scope, store_id) VALUES ('owner', $1, 'Owner', 'real', $2), ('demo', $1, 'Demo', 'demo', $2)", [hash, STORE]);
});
afterEach(() => c.pg.close());

describe('login', () => {
  it('right password gives a session; only its hash is stored', async () => {
    const r = await attemptLogin(c.app, 'real', 'owner', PW, '1.1.1.1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await readSession(c.app, 'real', r.token)).toMatchObject({ displayName: 'Owner', scope: 'real', storeId: STORE });
    const rows = await c.owner.query<{ token_hash: string }>('SELECT token_hash FROM dash_auth.sessions');
    expect(rows[0]!.token_hash).not.toBe(r.token);
  });

  it('wrong password and unknown user both say invalid', async () => {
    expect(await attemptLogin(c.app, 'real', 'owner', 'nope', '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
    expect(await attemptLogin(c.app, 'real', 'nobody', 'nope', '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks after repeated failures, even for the right password', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await attemptLogin(c.app, 'real', 'owner', 'nope', '1.1.1.1');
    expect(await attemptLogin(c.app, 'real', 'owner', PW, '1.1.1.1')).toEqual({ ok: false, reason: 'locked' });
  });

  it('an expired session does not work', async () => {
    const r = await attemptLogin(c.app, 'real', 'owner', PW, '1.1.1.1');
    if (!r.ok) throw new Error('login');
    await c.owner.query("UPDATE dash_auth.sessions SET expires_at = now() - interval '1 minute'");
    expect(await readSession(c.app, 'real', r.token)).toBeNull();
  });

  it('logout and sign-out-everywhere revoke sessions', async () => {
    const a = await attemptLogin(c.app, 'real', 'owner', PW, '1.1.1.1');
    const b = await attemptLogin(c.app, 'real', 'owner', PW, '1.1.1.1');
    if (!a.ok || !b.ok) throw new Error('login');
    await revokeSession(c.app, a.token);
    expect(await readSession(c.app, 'real', a.token)).toBeNull();
    const me = await readSession(c.app, 'real', b.token);
    await revokeAllSessions(c.app, me!.userId);
    expect(await readSession(c.app, 'real', b.token)).toBeNull();
  });
});

describe('demo and real are kept apart by the database', () => {
  it('the real role cannot log in or see demo users, and the demo role cannot see real ones', async () => {
    expect(await attemptLogin(c.app, 'real', 'demo', PW, '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
    expect(await attemptLogin(c.demo, 'demo', 'owner', PW, '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
    expect((await c.demo.query<{ username: string }>('SELECT username FROM dash_auth.users')).map((u) => u.username)).toEqual(['demo']);
  });

  it('a demo session is not valid on the real database', async () => {
    const r = await attemptLogin(c.demo, 'demo', 'demo', PW, '1.1.1.1');
    if (!r.ok) throw new Error('login');
    expect(await readSession(c.app, 'real', r.token)).toBeNull();
    expect(await readSession(c.app, 'demo', r.token)).toBeNull();
  });

  it('the demo role cannot read real figures, and the real role cannot read demo figures', async () => {
    await expect(c.demo.query('SELECT * FROM readmodel.snapshots')).rejects.toThrow(/permission denied/);
    await expect(c.app.query('SELECT * FROM demo.snapshots')).rejects.toThrow(/permission denied/);
  });
});

describe('read-only by database permission', () => {
  const writes = (table: string) => [`INSERT INTO ${table} DEFAULT VALUES`, `UPDATE ${table} SET store_id = store_id`, `DELETE FROM ${table}`];

  it('dashboard roles cannot change figures', async () => {
    for (const s of writes('readmodel.snapshots')) await expect(c.app.query(s)).rejects.toThrow(/permission denied/);
    for (const s of writes('demo.snapshots')) await expect(c.demo.query(s)).rejects.toThrow(/permission denied/);
  });

  it('dashboard roles cannot touch backups or device records at all', async () => {
    for (const db of [c.app, c.demo]) {
      for (const t of ['backup.manifests', 'backup.chunks', 'cloud.devices', 'cloud.stores', 'sync.events']) await expect(db.query(`SELECT * FROM ${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('the device role cannot read logins or demo data', async () => {
    for (const t of ['dash_auth.users', 'dash_auth.sessions', 'demo.snapshots']) await expect(c.device.query(`SELECT * FROM ${t}`)).rejects.toThrow(/permission denied/);
  });
});
