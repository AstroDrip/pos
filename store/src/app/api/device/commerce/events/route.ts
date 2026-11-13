import { applyEvents } from '@/server/device-core';
import { deviceRoute, readJson } from '@/server/routes';
import { eventBatch } from '@/shared/commerce-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => {
  const body = await readJson(req, eventBatch);
  return Response.json(await applyEvents(db, device, body.events, body.pending ?? 0));
});
