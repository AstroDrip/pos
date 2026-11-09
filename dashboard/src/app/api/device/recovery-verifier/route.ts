import { deviceRoute, readJson } from '@/server/device-route';
import { setRecoveryVerifier, verifierBody } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => {
  await setRecoveryVerifier(db, device, await readJson(req, verifierBody));
  return Response.json({ ok: true });
});
