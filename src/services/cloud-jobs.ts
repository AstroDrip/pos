import { createBackup } from './backup';
import { backupDue, fullVerifyDue, queueNewestBackup, recoveryVerifier, uploadPending, verifyCloudBackup } from './cloud-backup';
import type { CloudApi } from './cloud-client';
import type { Ctx } from './context';
import { dashboardEnabled, enqueueSnapshots, syncOnce } from './dashboard-sync';

// The background round. Runs beside the till, never in its way: a failure here only shows on the status screen.

export interface CloudJobEnv {
  dir: string;
  stagingPath: string;
  appVersion: string;
  getKey(): Buffer | null;
  api(): CloudApi | null;
}

/** One round: send figures, then make and send a backup when one is due. */
export async function cloudTick(ctx: Ctx, env: CloudJobEnv): Promise<void> {
  const api = env.api();
  if (!api) return;
  if (dashboardEnabled(ctx)) {
    enqueueSnapshots(ctx);
    const transport = { send: (events: Parameters<CloudApi['sync']>[0]) => api.sync(events) };
    for (let i = 0; i < 40; i++) {
      const r = await syncOnce(ctx, transport);
      if (r.sent === 0) break;
    }
    await api.heartbeat().catch(() => undefined); // tells the phone the till is alive even with nothing new
  }
  const key = env.getKey();
  if (!key) return;
  await api.setVerifier(recoveryVerifier(key)).catch(() => undefined);
  if (backupDue(ctx)) {
    createBackup(ctx, { dir: env.dir, masterKey: key, appVersion: env.appVersion, trigger: 'scheduled', userId: null });
    queueNewestBackup(ctx);
  }
  const up = await uploadPending(ctx, api, env.dir);
  if (!up.failed && fullVerifyDue(ctx) && up.uploaded === 0 && ctx.db.prepare("SELECT 1 FROM cloud_uploads WHERE status = 'uploaded'").get()) {
    await verifyCloudBackup(ctx, api, key, `${env.stagingPath}.verify`);
  }
}

/** A manual run: always makes a fresh backup. */
export async function backupNow(ctx: Ctx, env: CloudJobEnv, userId: number): Promise<{ uploaded: number; failed: boolean; backupId: string }> {
  const api = env.api();
  const key = env.getKey();
  if (!api || !key) throw new Error('Cloud backup is not set up');
  const r = createBackup(ctx, { dir: env.dir, masterKey: key, appVersion: env.appVersion, trigger: 'manual', userId });
  queueNewestBackup(ctx);
  ctx.db.prepare("UPDATE cloud_uploads SET next_try_at = ? WHERE status = 'queued'").run(ctx.now());
  return { ...(await uploadPending(ctx, api, env.dir)), backupId: r.backupId };
}
