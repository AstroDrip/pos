import { beforeAll, describe, expect, it } from 'vitest';
import { authenticate, enrollDevice } from '../src/server/device-core.ts';
import { ApiError } from '../src/server/errors.ts';
import { addCode, makeCloud, type TestCloud } from './helpers.ts';

let c: TestCloud;
beforeAll(async () => {
  c = await makeCloud();
});

const code = async (p: Promise<unknown>) => p.then(() => 'no error', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));
const body = (code: string) => ({ code, deviceName: 'Made up till' });

describe('device enrolment', () => {
  it('turns a one-time code into a credential that works', async () => {
    await addCode(c, 'good-code-0001');
    const r = await enrollDevice(c.device, '203.0.113.1', body('good-code-0001'));
    expect((await authenticate(c.device, `Bearer ${r.deviceId}.${r.deviceSecret}`)).deviceId).toBe(r.deviceId);
  });

  it('a code works only once', async () => {
    await addCode(c, 'good-code-0002');
    await enrollDevice(c.device, '203.0.113.2', body('good-code-0002'));
    expect(await code(enrollDevice(c.device, '203.0.113.2', body('good-code-0002')))).toBe('401 BAD_CODE');
  });

  it('refuses an expired or unknown code', async () => {
    await addCode(c, 'old-code-0003', "now() - interval '1 minute'");
    expect(await code(enrollDevice(c.device, '203.0.113.3', body('old-code-0003')))).toBe('401 BAD_CODE');
    expect(await code(enrollDevice(c.device, '203.0.113.3', body('no-such-code')))).toBe('401 BAD_CODE');
  });

  it('limits guessing from one address', async () => {
    let last = '';
    for (let i = 0; i < 12; i++) last = await code(enrollDevice(c.device, '203.0.113.4', body(`guess-code-${i}`)));
    expect(last).toBe('429 RATE_LIMITED');
  });

  it('stores only a hash of the secret, and audits the enrolment', async () => {
    await addCode(c, 'good-code-0005');
    const r = await enrollDevice(c.device, '203.0.113.5', body('good-code-0005'));
    const [d] = await c.owner.query<{ secret_hash: string }>('SELECT secret_hash FROM commerce.devices WHERE id = $1', [r.deviceId]);
    expect(d!.secret_hash).not.toContain(r.deviceSecret);
    const [a] = await c.owner.query('SELECT 1 AS found FROM commerce.audit_log WHERE action = $1 AND actor_id = $2', ['device.enrolled', r.deviceId]);
    expect(a).toBeDefined();
  });
});

describe('device credential', () => {
  it('refuses a wrong secret, a bad header and no header', async () => {
    await addCode(c, 'good-code-0006');
    const r = await enrollDevice(c.device, '203.0.113.6', body('good-code-0006'));
    expect(await code(authenticate(c.device, `Bearer ${r.deviceId}.${'x'.repeat(43)}`))).toBe('401 UNAUTHORIZED');
    expect(await code(authenticate(c.device, 'Basic abc'))).toBe('401 UNAUTHORIZED');
    expect(await code(authenticate(c.device, null))).toBe('401 UNAUTHORIZED');
  });

  it('a revoked device is refused', async () => {
    await addCode(c, 'good-code-0007');
    const r = await enrollDevice(c.device, '203.0.113.7', body('good-code-0007'));
    await c.owner.query("UPDATE commerce.devices SET status = 'revoked' WHERE id = $1", [r.deviceId]);
    expect(await code(authenticate(c.device, `Bearer ${r.deviceId}.${r.deviceSecret}`))).toBe('401 UNAUTHORIZED');
  });

  it('records when the device was last seen', async () => {
    await addCode(c, 'good-code-0008');
    const r = await enrollDevice(c.device, '203.0.113.8', body('good-code-0008'));
    await authenticate(c.device, `Bearer ${r.deviceId}.${r.deviceSecret}`);
    const [d] = await c.owner.query<{ last_contact_at: Date | null }>('SELECT last_contact_at FROM commerce.devices WHERE id = $1', [r.deviceId]);
    expect(d!.last_contact_at).not.toBeNull();
  });
});
