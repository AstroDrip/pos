import { z } from 'zod';
import { setProductStatus, updateProductWeb } from '@/server/admin-core';
import { ApiError } from '@/server/errors';
import { readJson, staffRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.strictObject({
  description: z.string().max(2000).optional(),
  featured: z.boolean().optional(),
  safetyStock: z.number().int().min(0).optional(),
  status: z.enum(['unpublished', 'published', 'archived']).optional(),
});

export const PATCH = staffRoute('products.edit', async (req, db, user) => {
  const id = Number(new URL(req.url).pathname.split('/').at(-1));
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(404, 'NOT_FOUND', 'Product not found.');
  const { status, ...web } = await readJson(req, body);
  if (status) await setProductStatus(db, user, id, status);
  if (Object.keys(web).length) await updateProductWeb(db, user, id, web);
  return Response.json({ ok: true });
});
