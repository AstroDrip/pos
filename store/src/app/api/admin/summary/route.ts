import { adminSummary } from '@/server/admin-core';
import { staffRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = staffRoute('orders.view', async (_req, db, user) => Response.json(await adminSummary(db, user), { headers: { 'cache-control': 'no-store' } }));
