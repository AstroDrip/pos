import { z } from 'zod';
import { changeOrderStatus } from '@/server/admin-core';
import { readJson, staffRoute } from '@/server/routes';
import { ORDER_STATUSES } from '@/domain/order-machine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.strictObject({ to: z.enum(ORDER_STATUSES), version: z.number().int().min(1), reason: z.string().max(500).optional() });

// The change itself checks the exact permission for that step.
export const POST = staffRoute('orders.view', async (req, db, user) => {
  const orderId = new URL(req.url).pathname.split('/').at(-2) ?? '';
  const b = await readJson(req, body);
  await changeOrderStatus(db, user, { orderId, ...b });
  return Response.json({ ok: true });
});
