import { resolveDiscrepancy } from '@/server/admin-core';
import { staffRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = staffRoute('stock.override', async (req, db, user) => {
  await resolveDiscrepancy(db, user, new URL(req.url).pathname.split('/').at(-1) ?? '');
  return Response.json({ ok: true });
});
