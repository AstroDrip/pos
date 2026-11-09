import { deviceRoute, readJson } from '@/server/device-route';
import { recordFullVerify, verifiedBody } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => {
  await recordFullVerify(db, device, await readJson(req, verifiedBody));
  return Response.json({ ok: true });
});
