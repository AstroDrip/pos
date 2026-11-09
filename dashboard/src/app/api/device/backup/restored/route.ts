import { deviceRoute, readJson } from '@/server/device-route';
import { recordRestore, restoreBody } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => {
  await recordRestore(db, device, await readJson(req, restoreBody));
  return Response.json({ ok: true });
});
