// Local proof of the whole path: real POS services → real HTTP routes → real Neon driver → local Postgres.
// Start dashboard/scripts/dev-sql-server.ts and `npm run dev` in dashboard/ first. Then, after npm run build:main:
//   node scripts/cloud-e2e-local.cjs <one-time code printed by the dev SQL server>
const { mkdtempSync, rmSync } = require('node:fs');
const { randomBytes, randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const dist = (p) => require(join(__dirname, '..', 'dist', 'main', p));
const URL_ = process.env.CLOUD_URL || 'http://localhost:3000';
const code = process.argv[2];
if (!code) throw new Error('Pass the one-time code');

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-e2e-'));
  try {
    const { openDatabase } = dist('db/connection.js');
    const { makeCtx } = dist('services/context.js');
    const { seedDemoShop } = dist('demo/seed.js');
    const { enqueueSnapshots, syncOnce, syncHealth } = dist('services/dashboard-sync.js');
    const client = dist('services/cloud-client.js');
    const cb = dist('services/cloud-backup.js');
    const { createBackup } = dist('services/backup.js');
    const { keyToRecoveryCode, recoveryCodeToKey } = dist('services/backup-crypto.js');

    const key = randomBytes(32);
    const db = openDatabase(join(dir, 'pos.db'));
    const ctx = { ...makeCtx(db), uuid: randomUUID };
    seedDemoShop(ctx, new Date().toISOString(), { days: 20 });
    ctx.db.prepare("UPDATE settings SET value = '1' WHERE key = 'dashboard_enabled'").run();

    const creds = await client.enrollDevice(fetch, URL_, { code, deviceName: 'E2E till', appVersion: 't', recoveryVerifier: cb.recoveryVerifier(key) });
    console.log('enrolled', Boolean(creds.deviceId));
    await client.enrollDevice(fetch, URL_, { code, deviceName: 'again', appVersion: 't' }).then(() => { throw new Error('code reused'); }, (e) => console.log('code refused second time:', e.code));

    const api = client.makeCloudApi(creds, fetch, 't');
    console.log('queued', enqueueSnapshots(ctx));
    const transport = { send: (ev) => api.sync(ev) };
    for (let i = 0; i < 20; i++) {
      const r = await syncOnce(ctx, transport);
      if (r.failed) throw new Error(`sync failed: ${syncHealth(ctx).lastError}`);
      if (r.sent === 0) break;
      console.log('sent', r.sent);
    }
    console.log('health', JSON.stringify({ ...syncHealth(ctx), lastError: syncHealth(ctx).lastError }));

    const backupDir = join(dir, 'backups');
    const b = createBackup(ctx, { dir: backupDir, masterKey: key, appVersion: 't', trigger: 'manual', userId: null });
    cb.queueNewestBackup(ctx);
    console.log('upload', JSON.stringify(await cb.uploadPending(ctx, api, backupDir)), JSON.stringify(cb.cloudStatus(ctx, true).state));
    const verify = await cb.verifyCloudBackup(ctx, api, key, join(dir, 'staging.db'));
    console.log('full verify', verify.ok, verify.detail ?? '');

    // A new computer: only the store id and the recovery code.
    const paper = recoveryCodeToKey(keyToRecoveryCode(key));
    const newCreds = await client.recoverDevice(fetch, URL_, { storeId: creds.storeId, recoveryToken: cb.recoveryToken(paper), deviceName: 'New PC', revokeOthers: true });
    const newApi = client.makeCloudApi(newCreds, fetch, 't');
    const list = await newApi.list();
    const row = list.find((x) => x.backupId === b.backupId);
    const m = await cb.fetchAndCheck(newApi, row, paper, join(dir, 'new-staging.db'));
    console.log('restored on new PC, products', m.verifiedCounts.products, 'sales', m.verifiedCounts.sales);
    await api.heartbeat().then(() => { throw new Error('old device still works'); }, (e) => console.log('old device cut off:', e.code));
    db.close();
    console.log('E2E OK');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error('E2E FAILED', e.code ?? '', e.message);
  process.exit(1);
});
