import { ApiError } from '@/server/errors';
import { getOrderForCustomer } from '@/server/order-core';
import { clientIp, shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The private link's secret travels in a header, never in the address, so it stays out of logs.
export const GET = shopRoute(async (req, db) => {
  const ref = new URL(req.url).pathname.split('/').at(-1) ?? '';
  const order = await getOrderForCustomer(db, ref, req.headers.get('x-order-token') ?? '', clientIp(req));
  if (!order) throw new ApiError(404, 'NOT_FOUND', 'We could not find that order.');
  return Response.json(order, { headers: { 'cache-control': 'no-store' } });
});
