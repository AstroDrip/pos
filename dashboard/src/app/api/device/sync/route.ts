import { deviceRoute, readJson } from '@/server/device-route';
import { ingest } from '@/server/device-core';
import { syncBody } from '@/shared/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => {
  const body = await readJson(req, syncBody);
  return Response.json(await ingest(db, device, body.events, body.appVersion));
});
