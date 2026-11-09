import { z } from 'zod';
import { deviceRoute, readJson } from '@/server/device-route';
import { heartbeat } from '@/server/device-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({ appVersion: z.string().max(30).optional() });

export const POST = deviceRoute(async (req, db, device) => {
  await heartbeat(db, device, (await readJson(req, body)).appVersion);
  return Response.json({ ok: true });
});
