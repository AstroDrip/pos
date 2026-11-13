import { pendingCommands } from '@/server/device-core';
import { deviceRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = deviceRoute(async (req, db) => {
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0);
  return Response.json({ commands: await pendingCommands(db, Number.isSafeInteger(after) && after >= 0 ? after : 0) });
});
