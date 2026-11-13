import { beforeAll, describe, expect, it } from 'vitest';
import { attemptLogin, authorizeRequest, MAX_FAILURES, readSession, requirePermission, revokeSession } from '../src/server/auth-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { getSettings, updateSettings } from '../src/server/settings-core.ts';
import { addStaff, makeCloud, TEST_PASSWORD, type TestCloud } from './helpers.ts';

let c: TestCloud;
const IP = '203.0.113.5';
beforeAll(async () => {
  c = await makeCloud();
  await addStaff(c, 'owner1', 'admin');
  await addStaff(c, 'super1', 'supervisor');
  await addStaff(c, 'cash1', 'cashier');
  await addStaff(c, 'gone1', 'admin', false);
});

async function signIn(username: string) {
  const r = await attemptLogin(c.app, username, TEST_PASSWORD, IP);
  if (!r.ok) throw new Error(r.reason);
  return r.token;
}
const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));
const SAME = { method: 'POST', origin: 'https://shop.test', host: 'shop.test' };

describe('staff login', () => {
  it('works with the right password and gives the role permissions', async () => {
    const user = await readSession(c.app, await signIn('cash1'));
    expect(user).toMatchObject({ displayName: 'Test cash1', role: 'cashier' });
    expect([...user!.permissions].sort()).toEqual(['orders.fulfil', 'orders.view', 'stock.view']);
  });

  it('is not case sensitive on the username', async () => {
    expect((await attemptLogin(c.app, ' OWNER1 ', TEST_PASSWORD, IP)).ok).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    expect(await attemptLogin(c.app, 'super1', 'wrong-password', '198.51.100.1')).toEqual({ ok: false, reason: 'invalid' });
    expect(await attemptLogin(c.app, 'nobody', 'wrong-password', '198.51.100.1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a disabled account', async () => {
    expect((await attemptLogin(c.app, 'gone1', TEST_PASSWORD, IP)).ok).toBe(false);
  });

  it('locks after too many failures, even with the right password', async () => {
    await addStaff(c, 'locked1', 'cashier');
    for (let i = 0; i < MAX_FAILURES; i++) await attemptLogin(c.app, 'locked1', 'wrong-password', '198.51.100.2');
    expect(await attemptLogin(c.app, 'locked1', TEST_PASSWORD, '198.51.100.3')).toEqual({ ok: false, reason: 'locked' });
  });

  it('stores only a hash of the session token', async () => {
    const token = await signIn('super1');
    const rows = await c.owner.query<{ token_hash: string }>('SELECT token_hash FROM commerce.staff_sessions');
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it('a signed-out session stops working', async () => {
    const token = await signIn('super1');
    await revokeSession(c.app, token);
    expect(await readSession(c.app, token)).toBeNull();
  });

  it('an expired session stops working', async () => {
    const token = await signIn('super1');
    await c.owner.query("UPDATE commerce.staff_sessions SET expires_at = now() - interval '1 minute'");
    expect(await readSession(c.app, token)).toBeNull();
  });

  it('disabling a user ends their session', async () => {
    await addStaff(c, 'temp1', 'admin');
    const token = await signIn('temp1');
    await c.owner.query("UPDATE commerce.staff_users SET active = false WHERE username = 'temp1'");
    expect(await readSession(c.app, token)).toBeNull();
  });
});

describe('server-side permission checks', () => {
  it('no session is 401', async () => {
    expect(await code(authorizeRequest(c.app, null, 'orders.view', SAME))).toBe('401 UNAUTHORIZED');
    expect(await code(authorizeRequest(c.app, 'not-a-real-token-at-all', 'orders.view', SAME))).toBe('401 UNAUTHORIZED');
  });

  it('a wrong role is refused on the server', async () => {
    expect(await code(authorizeRequest(c.app, await signIn('cash1'), 'settings.manage', SAME))).toBe('403 FORBIDDEN');
  });

  it('the right role passes', async () => {
    expect((await authorizeRequest(c.app, await signIn('owner1'), 'settings.manage', SAME)).role).toBe('admin');
  });

  it('a change from another site is refused', async () => {
    const token = await signIn('owner1');
    expect(await code(authorizeRequest(c.app, token, 'settings.manage', { ...SAME, origin: 'https://evil.test' }))).toBe('403 BAD_ORIGIN');
    expect(await code(authorizeRequest(c.app, token, 'settings.manage', { ...SAME, origin: null }))).toBe('403 BAD_ORIGIN');
  });

  it('a read does not need an origin header', async () => {
    expect((await authorizeRequest(c.app, await signIn('cash1'), 'orders.view', { method: 'GET', origin: null, host: 'shop.test' })).role).toBe('cashier');
  });

  it('requirePermission throws for a missing code', () => {
    expect(() => requirePermission({ userId: 1, displayName: 'x', role: 'cashier', permissions: new Set(['orders.view']) }, 'refunds.approve')).toThrow(ApiError);
  });
});

describe('store settings', () => {
  const user = async (name: string) => (await readSession(c.app, await signIn(name)))!;

  it('a cashier cannot change settings, even by calling the service directly', async () => {
    expect(await code(updateSettings(c.app, await user('cash1'), { deliveryFeeIncl: 1 }))).toBe('403 FORBIDDEN');
    expect((await getSettings(c.app)).deliveryFeeIncl).toBeNull();
  });

  it('an admin can, and it is audited', async () => {
    const s = await updateSettings(c.app, await user('owner1'), { deliveryFeeIncl: 1500, staleMinutes: 20 });
    expect(s).toMatchObject({ deliveryFeeIncl: 1500, staleMinutes: 20, freeDeliveryThreshold: 5000 });
    const [a] = await c.owner.query<{ action: string; actor: string; detail: { deliveryFeeIncl: number } }>("SELECT action, actor, detail FROM commerce.audit_log WHERE action = 'settings.update'");
    expect(a).toMatchObject({ action: 'settings.update', actor: 'staff', detail: { deliveryFeeIncl: 1500 } });
  });

  it('refuses bad values and unknown fields', async () => {
    const admin = await user('owner1');
    expect(await code(updateSettings(c.app, admin, { deliveryFeeIncl: -1 }))).toBe('400 INVALID');
    expect(await code(updateSettings(c.app, admin, { costPrice: 1 } as never))).toBe('400 INVALID');
  });
});
