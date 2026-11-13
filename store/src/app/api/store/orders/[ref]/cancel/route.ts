import { cancelByCustomer } from '@/server/order-core';
import { clientIp, shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = shopRoute(async (req, db) => {
  const ref = new URL(req.url).pathname.split('/').at(-2) ?? '';
  await cancelByCustomer(db, ref, req.headers.get('x-order-token') ?? '', clientIp(req));
  return Response.json({ ok: true });
});
