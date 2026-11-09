// Backup to a stand-in cloud that holds pieces the way the real one does. The real server has its own tests.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup } from './backup';
import { decryptBackup, keyToRecoveryCode, readManifest, recoveryCodeToKey } from './backup-crypto';
import { backupDue, chunksOf, cloudStatus, compareWithLive, fetchAndCheck, fullVerifyDue, queueNewestBackup, recoveryToken, recoveryVerifier, uploadPending, verifyCloudBackup } from './cloud-backup';
import { CloudError, normaliseUrl, type CloudApi, type RemoteBackup, type StartMeta } from './cloud-client';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let dir: string;
const key = randomBytes(32);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

class FakeCloud implements CloudApi {
  metas = new Map<string, StartMeta & { done: boolean }>();
  pieces = new Map<string, Buffer>();
  putCount = 0;
  failAfter: number | null = null;
  fail: CloudError = new CloudError('No internet connection to the cloud', 'offline', 'NETWORK');
  verifiedCalls: { backupId: string; ok: boolean }[] = [];
  sync = async () => ({ acceptedIds: [] });
  heartbeat = async () => {};
  setVerifier = async () => {};
  restored = async () => {};
  async start(m: StartMeta) {
    const had = this.metas.get(m.backupId);
    if (!had) this.metas.set(m.backupId, { ...m, done: false });
    return { have: [...this.pieces.keys()].filter((k) => k.startsWith(`${m.backupId}/`)).map((k) => Number(k.split('/')[1])), status: had?.done ? 'uploaded' : 'uploading' };
  }
  async putChunk(id: string, i: number, _sha: string, data: Buffer) {
    if (this.failAfter !== null && this.putCount >= this.failAfter) throw this.fail;
    this.putCount++;
    this.pieces.set(`${id}/${i}`, Buffer.from(data));
  }
  async finish(id: string) {
    this.metas.get(id)!.done = true;
  }
  async list(): Promise<RemoteBackup[]> {
    return [...this.metas.values()].map((m) => ({ ...m, uploadStatus: m.done ? 'uploaded' : 'uploading', verificationStatus: 'server_ok', uploadedAt: null, verifiedAt: null }));
  }
  async getChunk(id: string, i: number) {
    const data = this.pieces.get(`${id}/${i}`)!;
    return { data, sha256: sha(data) };
  }
  async verified(backupId: string, ok: boolean) {
    this.verifiedCalls.push({ backupId, ok });
  }
}

const backup = () => createBackup(ctx, { dir, masterKey: key, appVersion: 't', trigger: 'scheduled', userId: null });
let cloud: FakeCloud;
const staging = () => join(dir, 'staging.db');
const product = (sku: string) => createProduct(ctx, u.admin, { sku, nameEn: `Item ${sku}`, nameAr: 'صنف', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 900 });
const remote = async (id: string) => (await cloud.list()).find((b) => b.backupId === id)!;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  dir = mkdtempSync(join(tmpdir(), 'pos-cloud-'));
  cloud = new FakeCloud();
  for (let i = 0; i < 20; i++) product(`S${i}`);
});
afterEach(() => {
  t.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('what leaves this computer', () => {
  it('backups are encrypted and compressed: no SQLite header, and smaller than the database', () => {
    const r = backup();
    const file = readFileSync(join(dir, r.fileName));
    expect(file.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(file.includes(Buffer.from('Item S1'))).toBe(false);
    expect(readManifest(file).manifest.format).toBe(2);
    expect(file.length).toBeLessThan(r.manifest.plainBytes);
    const { plain } = decryptBackup(file, key);
    expect(plain.subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('every piece sent is ciphertext, never the database', async () => {
    backup();
    queueNewestBackup(ctx);
    await uploadPending(ctx, cloud, dir, 4096);
    expect(cloud.pieces.size).toBeGreaterThan(1);
    for (const p of cloud.pieces.values()) expect(p.includes(Buffer.from('SQLite format 3'))).toBe(false);
  });

  it('the recovery token is one-way: it reveals neither the key nor the recovery code', () => {
    const token = recoveryToken(key);
    expect(token).not.toContain(key.toString('base64url'));
    expect(token).not.toContain(keyToRecoveryCode(key).replaceAll('-', ''));
    expect(recoveryVerifier(key)).toBe(sha(token));
    expect(recoveryToken(randomBytes(32))).not.toBe(token);
  });

  it('only an https address is accepted, apart from this computer', () => {
    expect(normaliseUrl('https://x.example/a/b')).toBe('https://x.example');
    expect(normaliseUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => normaliseUrl('http://x.example')).toThrow(/https/);
    expect(() => normaliseUrl('nonsense')).toThrow(/https/);
  });
});

describe('upload', () => {
  it('goes in pieces of the right size and is marked done', async () => {
    const r = backup();
    expect(queueNewestBackup(ctx)).toBe(r.backupId);
    expect(await uploadPending(ctx, cloud, dir, 4096)).toEqual({ uploaded: 1, failed: false });
    const file = readFileSync(join(dir, r.fileName));
    const m = cloud.metas.get(r.backupId)!;
    expect(m).toMatchObject({ sha256: sha(file), encryptedBytes: file.length, chunkSize: 4096, chunkCount: chunksOf(file, 4096).length, schemaVersion: r.manifest.schemaVersion, formatVersion: 2, encryptionVersion: 1 });
    expect(m.chunksRoot).toBe(sha(chunksOf(file, 4096).map((c) => sha(c)).join('')));
    expect(cloudStatus(ctx, true).state).toBe('ok');
  });

  it('the same backup is not queued twice', () => {
    backup();
    expect(queueNewestBackup(ctx)).not.toBeNull();
    expect(queueNewestBackup(ctx)).toBeNull();
  });

  it('a dropped connection keeps the job, says so, and resumes without re-sending pieces', async () => {
    backup();
    queueNewestBackup(ctx);
    cloud.failAfter = 2;
    expect(await uploadPending(ctx, cloud, dir, 4096)).toEqual({ uploaded: 0, failed: true });
    expect(cloudStatus(ctx, true)).toMatchObject({ state: 'waiting_internet', pending: 1, lastError: 'No internet connection to the cloud' });
    expect(await uploadPending(ctx, cloud, dir, 4096)).toEqual({ uploaded: 0, failed: false }); // not due yet
    expect(cloud.putCount).toBe(2);
    cloud.failAfter = null;
    t.advance(61_000);
    const sent = cloud.putCount;
    expect(await uploadPending(ctx, cloud, dir, 4096)).toEqual({ uploaded: 1, failed: false });
    expect(cloud.putCount - sent).toBe(cloud.pieces.size - 2);
  });

  it('a remote outage is reported differently from no internet', async () => {
    backup();
    queueNewestBackup(ctx);
    cloud.failAfter = 0;
    cloud.fail = new CloudError('Try again later.', 'remote', 'UNAVAILABLE');
    await uploadPending(ctx, cloud, dir, 4096);
    expect(cloudStatus(ctx, true).state).toBe('remote_unavailable');
  });

  it('a newer backup replaces one that has not gone yet', async () => {
    backup();
    queueNewestBackup(ctx);
    t.advance(1000);
    const newer = backup();
    queueNewestBackup(ctx);
    expect(await uploadPending(ctx, cloud, dir, 4096)).toEqual({ uploaded: 1, failed: false });
    expect([...cloud.metas.keys()]).toEqual([newer.backupId]);
  });

  it('survives a restart: the queue is in the database', async () => {
    const r = backup();
    queueNewestBackup(ctx);
    expect(ctx.db.prepare('SELECT status FROM cloud_uploads WHERE backup_id = ?').get(r.backupId)).toEqual({ status: 'queued' });
  });

  it('a local file that has gone is reported and not retried', async () => {
    const r = backup();
    queueNewestBackup(ctx);
    rmSync(join(dir, r.fileName));
    expect((await uploadPending(ctx, cloud, dir, 4096)).failed).toBe(true);
    expect(cloudStatus(ctx, true).lastError).toMatch(/no longer exists/);
  });

  it('knows when the next backup and full check are due', async () => {
    expect(backupDue(ctx)).toBe(true);
    backup();
    queueNewestBackup(ctx);
    expect(backupDue(ctx)).toBe(false);
    t.advance(25 * 3_600_000);
    expect(backupDue(ctx)).toBe(true);
    expect(fullVerifyDue(ctx)).toBe(true);
  });

  it('with no setup the status says so', () => {
    expect(cloudStatus(ctx, false).state).toBe('not_configured');
    expect(cloudStatus(ctx, true).state).toBe('no_backup_yet');
  });
});

describe('verify and restore', () => {
  const upload = async () => {
    const r = backup();
    queueNewestBackup(ctx);
    await uploadPending(ctx, cloud, dir, 4096);
    return r;
  };

  it('a full test proves the backup and is recorded, without touching live data', async () => {
    const r = await upload();
    expect(await verifyCloudBackup(ctx, cloud, key, staging())).toEqual({ backupId: r.backupId, ok: true, detail: undefined });
    expect(cloud.verifiedCalls).toEqual([{ backupId: r.backupId, ok: true }]);
    expect(cloudStatus(ctx, true).lastFullVerifyAt).not.toBeNull();
    expect(ctx.db.open).toBe(true);
  });

  it('a corrupted piece is rejected', async () => {
    const r = await upload();
    const k = `${r.backupId}/0`;
    const bad = Buffer.from(cloud.pieces.get(k)!);
    bad[20] = bad[20]! ^ 0xff;
    cloud.pieces.set(k, bad);
    await expect(fetchAndCheck(cloud, await remote(r.backupId), key, staging())).rejects.toThrow(/integrity check/);
  });

  it('a corrupted backup makes the verification test fail and shows it', async () => {
    const r = await upload();
    const k = `${r.backupId}/1`;
    const bad = Buffer.from(cloud.pieces.get(k)!);
    bad[3] = bad[3]! ^ 0xff;
    cloud.pieces.set(k, bad);
    expect((await verifyCloudBackup(ctx, cloud, key, staging())).ok).toBe(false);
    expect(cloudStatus(ctx, true).state).toBe('verification_failed');
  });

  it('a network failure during the test does not mark the backup as bad', async () => {
    await upload();
    cloud.getChunk = async () => { throw new CloudError('No internet connection to the cloud', 'offline', 'NETWORK'); };
    await expect(verifyCloudBackup(ctx, cloud, key, staging())).rejects.toThrow(/internet/);
    expect(cloud.verifiedCalls).toEqual([]);
  });

  it('the wrong recovery key is rejected', async () => {
    const r = await upload();
    await expect(fetchAndCheck(cloud, await remote(r.backupId), randomBytes(32), staging())).rejects.toThrow(/different backup key/);
  });

  it('restores into a temporary file with the right facts', async () => {
    const r = await upload();
    const m = await fetchAndCheck(cloud, await remote(r.backupId), key, staging());
    expect(m.verifiedCounts.products).toBe(20);
    expect(m.createdAt).toBe(r.manifest.createdAt);
  });

  it('a backup from a newer app is refused', async () => {
    const r = await upload();
    const fake = { ...r.manifest };
    expect(fake.schemaVersion).toBeGreaterThan(0);
    const { encryptBackup } = await import('./backup-crypto');
    const made = encryptBackup(readFileSync(t.path), key, { backupId: 'future-backup', createdAt: r.manifest.createdAt, appVersion: 't', schemaVersion: 9999, counts: {}, lastInvoiceNo: null });
    const pieces = chunksOf(made.file, 4096);
    pieces.forEach((p, i) => cloud.pieces.set(`future-backup/${i}`, p));
    const row: RemoteBackup = { ...(await remote(r.backupId)), backupId: 'future-backup', uploadStatus: 'uploaded', encryptedBytes: made.file.length, sha256: sha(made.file), chunkCount: pieces.length };
    await expect(fetchAndCheck(cloud, row, key, staging())).rejects.toThrow(/newer version/);
  });

  it('works on another computer with only the recovery code, and no file from this one', async () => {
    const r = await upload();
    const code = keyToRecoveryCode(key);
    const other = makeTestCtx(); // a new, empty computer
    try {
      const fromPaper = recoveryCodeToKey(code);
      expect(recoveryVerifier(fromPaper)).toBe(recoveryVerifier(key));
      const m = await fetchAndCheck(cloud, await remote(r.backupId), fromPaper, join(mkdtempSync(join(tmpdir(), 'pos-new-pc-')), 'staging.db'));
      expect(m.verifiedCounts.products).toBe(20);
      expect(compareWithLive(other.ctx, m).newerLocal).toBe(false);
    } finally {
      other.cleanup();
    }
  });

  it('warns when the live database has data the backup does not', () => {
    expect(compareWithLive(ctx, { createdAt: '2026-01-01T00:00:00.000Z', verifiedCounts: { sales: 0 } }).newerLocal).toBe(false);
    ctx.db.exec('CREATE TEMP TABLE noop (x)');
    const live = compareWithLive(ctx, { createdAt: '2026-01-01T00:00:00.000Z', verifiedCounts: { sales: -1 } });
    expect(live.newerLocal).toBe(true);
  });
});
