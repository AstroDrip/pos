import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestCtx } from '../services/test-helpers';
import { createUser } from '../services/users';
import { CHANNELS } from '../shared/ipc';
import { createHandlers, type BackupEnv, type Session } from './handlers';
import { receiptHtml } from './receipt-html';

let t: ReturnType<typeof makeTestCtx>;
let dispatch: ReturnType<typeof createHandlers>;
let printed: number;
let s: Session;

beforeEach(() => {
  t = makeTestCtx();
  printed = 0;
  dispatch = createHandlers(t.ctx, { printReceipt: async () => void printed++ });
  s = { user: null };
});
afterEach(() => t.cleanup());

describe('IPC boundary', () => {
  it('preload allowlist matches the shared channel list exactly', () => {
    const src = readFileSync(join(__dirname, '..', 'preload', 'preload.ts'), 'utf8');
    const list = [...src.matchAll(/^\s+'([a-zA-Z.]+)',$/gm)].map((m) => m[1]);
    expect(list.sort()).toEqual([...CHANNELS].sort());
  });

  it('rejects unknown channels, bad payloads and anonymous calls', async () => {
    expect(await dispatch('fs.readFile', {}, s)).toMatchObject({ ok: false, code: 'BAD_CHANNEL' });
    expect(await dispatch('__proto__', {}, s)).toMatchObject({ ok: false, code: 'BAD_CHANNEL' });
    expect(await dispatch('shift.open', { openingFloat: 1.5 }, s)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await dispatch('shift.open', { openingFloat: 100 }, s)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(await dispatch('catalog.lookup', { code: 'x'.repeat(65) }, s)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('first-run setup works once only', async () => {
    expect(await dispatch('auth.status', null, s)).toMatchObject({ ok: true, data: { needsSetup: true } });
    expect(await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s)).toMatchObject({ ok: true });
    expect(s.user?.username).toBe('owner');
    const s2: Session = { user: null };
    expect(await dispatch('auth.setupAdmin', { username: 'evil', displayName: 'x', pin: '1111' }, s2)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('end-to-end over IPC: create product, open shift, sell, reprint', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    const p = await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250, barcodes: ['6281000000014'] }, s);
    expect(p.ok).toBe(true);
    await dispatch('shift.open', { openingFloat: 0 }, s);
    const look = await dispatch('catalog.lookup', { code: '6281000000014' }, s);
    expect(look).toMatchObject({ ok: true, data: { qty: 1000 } });
    const sale = await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-1', lines: [{ productId: 1, qty: 1000 }], payments: [{ tender: 'cash', amount: 500 }] }, s);
    expect(sale).toMatchObject({ ok: true, data: { invoiceNo: 'INV-00000001', changeGiven: 250 } });
    expect(await dispatch('sale.print', { saleId: 1, copy: true }, s)).toMatchObject({ ok: true });
    expect(printed).toBe(1);
    expect((t.ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(1); // reprint made no sale
  });

  it('a wrong supervisor PIN does not approve a discount', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 }, s);
    // a cashier has no discount rights of their own
    createUser(t.ctx, s.user!.id, { username: 'cashier', displayName: 'C', pin: '1111', roles: ['cashier'] });
    await dispatch('shift.open', { openingFloat: 0 }, s);
    const c: Session = { user: null };
    await dispatch('auth.login', { username: 'cashier', pin: '1111' }, c);
    const r = await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-2', lines: [{ productId: 1, qty: 1000, discount: 50 }], payments: [{ tender: 'cash', amount: 200 }], approver: { username: 'owner', pin: '0000' } }, c);
    expect(r).toMatchObject({ ok: false, code: 'AUTH_FAILED' });
  });
});

describe('receipt HTML', () => {
  it('escapes product names and marks copies', () => {
    const html = receiptHtml(
      { invoiceNo: 'INV-1', uuid: 'u', createdAt: '2026-11-04T20:27:20.451Z', cashier: '<b>', lines: [{ nameAr: 'تفاح', nameEn: '<script>x</script>', qty: 1235, unitPriceIncl: 799, discount: 0, lineIncl: 987, vatRateBp: 1500 }], totalExcl: 858, totalVat: 129, totalIncl: 987, totalDiscount: 0, payments: [{ tender: 'cash', amount: 1000 }], changeGiven: 13 },
      { nameAr: 'متجر', nameEn: 'Store', vatNumber: '' },
      true,
    );
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('COPY');
    expect(html).toContain('9.87');
    expect(html).toContain('NOT A ZATCA TAX INVOICE');
    expect(html).toContain('2026-11-04 23:27'); // Riyadh time, not UTC
  });
});

describe('backup and restore over IPC', () => {
  function fakeEnv(dir: string): BackupEnv & { applied: string[]; key: Buffer | null; file: string } {
    const env = {
      dir,
      appVersion: 't',
      stagingPath: join(dir, 'stage.db'),
      key: null as Buffer | null,
      applied: [] as string[],
      file: '',
      getKey: () => env.key,
      saveNewKey: (k: Buffer) => void (env.key = k),
      newKey: () => randomBytes(32),
      pickBackupFile: async () => env.file || null,
      applyRestore: (p: string) => void env.applied.push(p),
    };
    return env;
  }

  it('key is created once by an admin and the recovery code restores on a fresh install', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-ipc-bak-'));
    const env = fakeEnv(dir);
    const d = createHandlers(t.ctx, { printReceipt: async () => {} }, env);
    await d('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    expect(await d('backup.run', null, s)).toMatchObject({ ok: false, message: /key first/ });
    const k = await d('backup.setupKey', null, s);
    expect(k).toMatchObject({ ok: true });
    expect(await d('backup.setupKey', null, s)).toMatchObject({ ok: false, code: 'CONFLICT' });
    const run = (await d('backup.run', null, s)) as { ok: true; data: { fileName: string } };
    expect(run.ok).toBe(true);
    expect(await d('backup.status', null, s)).toMatchObject({ ok: true, data: { keyConfigured: true, lastVerifiedLocal: { fileName: run.data.fileName } } });

    // New computer: empty database, nobody logged in, no key yet.
    const t2 = makeTestCtx();
    const env2 = fakeEnv(dir);
    env2.file = join(dir, run.data.fileName);
    const d2 = createHandlers(t2.ctx, { printReceipt: async () => {} }, env2);
    const anon: Session = { user: null };
    expect(await d2('restore.prepare', {}, anon)).toMatchObject({ ok: false, message: /recovery code/ });
    const code = (k as { ok: true; data: { recoveryCode: string } }).data.recoveryCode;
    expect(await d2('restore.prepare', { recoveryCode: code }, anon)).toMatchObject({ ok: true, data: { counts: { users: 1 } } });
    expect(await d2('restore.apply', null, anon)).toMatchObject({ ok: true });
    expect(env2.applied).toEqual([env2.stagingPath]);
    expect(env2.key?.equals(env.key!)).toBe(true);
    t2.cleanup();

    // Once users exist, an anonymous session can no longer restore.
    expect(await d('restore.prepare', {}, { user: null })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    rmSync(dir, { recursive: true, force: true });
  });
});
