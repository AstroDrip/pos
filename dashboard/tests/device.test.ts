import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticate, enrollDevice, ingest, recoverDevice, type Device } from '../src/server/device-core.ts';
import { chooseRemovals, finishUpload, getChunk, listBackups, MAX_CHUNK, putChunk, recordFullVerify, startUpload } from '../src/server/backup-core.ts';
import { syncBody, type DaySnapshot } from '../src/shared/snapshots.ts';
import { addCode, addStore, makeCloud, OTHER, STORE, type TestCloud } from './helpers.ts';

let c: TestCloud;
let d: Device;
let bearer: string;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const IP = '9.9.9.9';

beforeEach(async () => {
  c = await makeCloud();
  await addStore(c);
  await addCode(c, 'ONE-TIME-CODE');
  const r = await enrollDevice(c.device, IP, { code: 'ONE-TIME-CODE', deviceName: 'Till 1', appVersion: '1.0', recoveryVerifier: sha('recovery-token-for-this-made-up-store') });
  d = { deviceId: r.deviceId, storeId: r.storeId };
  bearer = `Bearer ${r.deviceId}.${r.deviceSecret}`;
});
afterEach(() => c.pg.close());

const DAY: DaySnapshot = { day: '2026-11-05', salesInclVat: 11_500, transactions: 2, netSales: 10_000, returns: 0, discounts: 0, cogs: 6_000, grossProfit: 4_000, operatingExpenses: 1_000, netProfit: 3_000, outputVat: 1_500, inputVat: 0, cash: 11_500, card: 0, onAccount: 0, supplierCreditPurchases: 0, expenses: [], byCategory: [], byProduct: [], provisional: true };
const ev = (version: number, payload = DAY, eventId: string = randomUUID()) => ({ eventId, kind: 'day' as const, snapKey: payload.day, version, createdAt: new Date().toISOString(), payload });
const stored = async () => (await c.owner.query<{ version: number; payload: DaySnapshot }>("SELECT version, payload FROM readmodel.snapshots WHERE kind = 'day'"))[0];

describe('device login', () => {
  it('a code works once', async () => {
    await expect(enrollDevice(c.device, IP, { code: 'ONE-TIME-CODE', deviceName: 'Till 2' })).rejects.toMatchObject({ status: 401 });
  });

  it('a good credential passes; wrong, malformed and revoked ones do not', async () => {
    expect(await authenticate(c.device, bearer)).toEqual(d);
    await expect(authenticate(c.device, `Bearer ${d.deviceId}.${'x'.repeat(43)}`)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(c.device, null)).rejects.toMatchObject({ status: 401 });
    await c.owner.query("UPDATE cloud.devices SET status = 'revoked'");
    await expect(authenticate(c.device, bearer)).rejects.toMatchObject({ status: 401 });
  });

  it('too many enrol attempts are stopped', async () => {
    let last: unknown;
    for (let i = 0; i < 12; i++) last = await enrollDevice(c.device, '5.5.5.5', { code: 'WRONG-CODE-x', deviceName: 'X' }).catch((e: unknown) => e);
    expect(last).toMatchObject({ status: 429 });
  });

  it('a new computer gets in with the recovery token, and old devices are cut off', async () => {
    await expect(recoverDevice(c.device, IP, { storeId: STORE, recoveryToken: 'wrong-token-for-this-made-up-store-0000', deviceName: 'New', revokeOthers: true })).rejects.toMatchObject({ status: 401 });
    const r = await recoverDevice(c.device, IP, { storeId: STORE, recoveryToken: 'recovery-token-for-this-made-up-store', deviceName: 'New', revokeOthers: true });
    expect(r.deviceId).not.toBe(d.deviceId);
    await expect(authenticate(c.device, bearer)).rejects.toMatchObject({ status: 401 });
  });
});

describe('sync', () => {
  it('rejects a bad payload', () => {
    expect(syncBody.safeParse({ events: [{ ...ev(1), payload: { ...DAY, salesInclVat: 1.5 } }] }).success).toBe(false);
    expect(syncBody.safeParse({ events: [{ ...ev(1), kind: 'nonsense' }] }).success).toBe(false);
    expect(syncBody.safeParse({ events: [ev(1)] }).success).toBe(true);
  });

  it('stores an event and records when', async () => {
    const e = ev(1);
    expect(await ingest(c.device, d, [e], '1.0')).toEqual({ acceptedIds: [e.eventId], applied: 1 });
    expect((await stored())!.payload.salesInclVat).toBe(11_500);
    const [s] = await c.owner.query<{ last_success_at: Date; last_data_at: Date; store_name: string }>('SELECT * FROM readmodel.status');
    expect(s!.store_name).toBe('Made Up Grocery');
    expect(s!.last_success_at).toBeTruthy();
    expect(s!.last_data_at).toBeTruthy();
  });

  it('the same event sent twice is applied once and still confirmed', async () => {
    const e = ev(1);
    await ingest(c.device, d, [e]);
    expect(await ingest(c.device, d, [e])).toEqual({ acceptedIds: [e.eventId], applied: 0 });
    expect((await c.owner.query('SELECT 1 FROM sync.events'))).toHaveLength(1);
  });

  it('an older version arriving late never overwrites a newer one', async () => {
    await ingest(c.device, d, [ev(5, { ...DAY, salesInclVat: 500 })]);
    const late = ev(3, { ...DAY, salesInclVat: 300 });
    expect((await ingest(c.device, d, [late])).acceptedIds).toEqual([late.eventId]);
    expect(await stored()).toMatchObject({ version: 5, payload: { salesInclVat: 500 } });
  });

  it('within one batch the highest version wins', async () => {
    await ingest(c.device, d, [ev(2, { ...DAY, salesInclVat: 200 }), ev(4, { ...DAY, salesInclVat: 400 }), ev(3, { ...DAY, salesInclVat: 300 })]);
    expect(await stored()).toMatchObject({ version: 4, payload: { salesInclVat: 400 } });
  });

  it('a device cannot write into another store by reusing an event id', async () => {
    await addStore(c, OTHER, 'Other');
    await addCode(c, 'SECOND-CODE-1', OTHER);
    const r = await enrollDevice(c.device, '2.2.2.2', { code: 'SECOND-CODE-1', deviceName: 'Other till' });
    const e = ev(1);
    await ingest(c.device, d, [e]);
    await expect(ingest(c.device, { deviceId: r.deviceId, storeId: r.storeId }, [e])).rejects.toMatchObject({ status: 409 });
  });

  it('a database failure confirms nothing', async () => {
    const failing = { ...c.device, batch: async () => { throw new Error('database unavailable'); } };
    await expect(ingest(failing, d, [ev(1)])).rejects.toThrow('database unavailable');
    expect(await stored()).toBeUndefined();
  });
});

describe('backup upload', () => {
  const SIZE = 1000;
  const file = Buffer.alloc(2_500, 7);
  const parts = [file.subarray(0, SIZE), file.subarray(SIZE, 2 * SIZE), file.subarray(2 * SIZE)];
  const meta = (id = 'backup-0001') => ({ backupId: id, createdAt: '2026-11-05T10:00:00.000Z', appVersion: '1.0', schemaVersion: 16, formatVersion: 2, encryptionVersion: 1, originalBytes: 9_000, encryptedBytes: file.length, sha256: sha(file), chunkCount: 3, chunkSize: SIZE, chunksRoot: sha(parts.map((p) => sha(p)).join('')) });
  const send = (i: number, id = 'backup-0001') => putChunk(c.device, d, id, i, sha(parts[i]!), Buffer.from(parts[i]!));

  it('upload, finish, list and download', async () => {
    expect(await startUpload(c.device, d, meta())).toEqual({ have: [], status: 'uploading' });
    for (const i of [0, 1, 2]) expect(await send(i)).toEqual({ stored: true });
    expect(await finishUpload(c.device, d, 'backup-0001')).toMatchObject({ status: 'uploaded', verification: 'server_ok' });
    const [row] = await listBackups(c.device, d);
    expect(row).toMatchObject({ backupId: 'backup-0001', encryptedBytes: 2_500, verificationStatus: 'server_ok', originalBytes: 9_000 });
    const got = await getChunk(c.device, d, 'backup-0001', 1);
    expect(got.data.equals(Buffer.from(parts[1]!))).toBe(true);
  });

  it('resuming returns the pieces already stored; repeating a piece stores nothing', async () => {
    await startUpload(c.device, d, meta());
    await send(0);
    expect(await startUpload(c.device, d, meta())).toEqual({ have: [0], status: 'uploading' });
    expect(await send(0)).toEqual({ stored: false });
    expect(await c.owner.query('SELECT 1 FROM backup.chunks')).toHaveLength(1);
  });

  it('finishing early is refused', async () => {
    await startUpload(c.device, d, meta());
    await send(0);
    await expect(finishUpload(c.device, d, 'backup-0001')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });

  it('a damaged piece, wrong size or oversize piece is refused', async () => {
    await startUpload(c.device, d, meta());
    await expect(putChunk(c.device, d, 'backup-0001', 0, sha('other'), Buffer.from(parts[0]!))).rejects.toMatchObject({ code: 'BAD_HASH' });
    const small = Buffer.alloc(10, 1);
    await expect(putChunk(c.device, d, 'backup-0001', 0, sha(small), small)).rejects.toMatchObject({ code: 'BAD_SIZE' });
    const big = Buffer.alloc(MAX_CHUNK + 1);
    await expect(putChunk(c.device, d, 'backup-0001', 0, sha(big), big)).rejects.toMatchObject({ status: 413 });
  });

  it('a size that does not fit the piece count is refused', async () => {
    await expect(startUpload(c.device, d, { ...meta(), encryptedBytes: 99_999 })).rejects.toMatchObject({ code: 'BAD_SIZE' });
  });

  it('a stored backup with wrong hashes fails verification', async () => {
    await startUpload(c.device, d, { ...meta(), chunksRoot: 'a'.repeat(64) });
    for (const i of [0, 1, 2]) await send(i);
    await expect(finishUpload(c.device, d, 'backup-0001')).rejects.toMatchObject({ code: 'VERIFY_FAILED' });
    expect((await listBackups(c.device, d))[0]!.verificationStatus).toBe('failed');
  });

  it('another store cannot see or fetch this backup', async () => {
    await startUpload(c.device, d, meta());
    await send(0);
    await addStore(c, OTHER, 'Other');
    await addCode(c, 'SECOND-CODE-1', OTHER);
    const r = await enrollDevice(c.device, '2.2.2.2', { code: 'SECOND-CODE-1', deviceName: 'Other till' });
    const other = { deviceId: r.deviceId, storeId: r.storeId };
    expect(await listBackups(c.device, other)).toEqual([]);
    await expect(getChunk(c.device, other, 'backup-0001', 0)).rejects.toMatchObject({ status: 404 });
  });

  it('a full check by the POS is recorded', async () => {
    await startUpload(c.device, d, meta());
    for (const i of [0, 1, 2]) await send(i);
    await finishUpload(c.device, d, 'backup-0001');
    await recordFullVerify(c.device, d, { backupId: 'backup-0001', ok: true });
    expect((await listBackups(c.device, d))[0]!.verificationStatus).toBe('full_ok');
  });
});

describe('retention', () => {
  const at = (day: number, verified = true) => ({ backupId: `b-${day}`, createdAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000`, verified });

  it('never removes the newest verified backup, even with nothing else to keep', () => {
    expect(chooseRemovals([at(1)], 0, 0)).toEqual([]);
  });

  it('keeps the newest of each recent day and removes the rest', () => {
    const items = [1, 2, 3, 4, 5].map((d) => at(d));
    expect(chooseRemovals(items, 2, 0).sort()).toEqual(['b-1', 'b-2', 'b-3']);
  });

  it('leaves unverified backups alone', () => {
    expect(chooseRemovals([at(5), at(4, false), at(3, false)], 1, 0)).toEqual([]);
  });

  it('an unverified newest backup does not count as the safe one', () => {
    expect(chooseRemovals([at(5, false), at(4), at(3)], 1, 0)).toEqual(['b-3']);
  });
});
