import { reservedTotals } from '@/server/device-core';
import { deviceRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = deviceRoute(async (_req, db) => Response.json({ totals: await reservedTotals(db) }));
