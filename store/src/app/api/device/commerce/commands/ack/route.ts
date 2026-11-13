import { z } from 'zod';
import { ackCommands } from '@/server/device-core';
import { deviceRoute, readJson } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = deviceRoute(async (req, db) => {
  const { ids } = await readJson(req, z.strictObject({ ids: z.array(z.number().int().positive()).max(100) }));
  await ackCommands(db, ids);
  return Response.json({ ok: true });
});
