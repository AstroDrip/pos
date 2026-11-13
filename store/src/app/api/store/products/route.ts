import { z } from 'zod';
import { listProducts } from '@/server/catalog-core';
import { ApiError } from '@/server/errors';
import { shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().max(80).optional(),
  sort: z.enum(['recommended', 'name', 'price_asc', 'price_desc']).optional(),
  stock: z.literal('1').optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const GET = shopRoute(async (req, db) => {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'That search is not valid.');
  const { stock, ...rest } = parsed.data;
  return Response.json(await listProducts(db, { ...rest, inStockOnly: stock === '1', limit: 24 }));
});
