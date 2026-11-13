import { cartBody, quoteCart } from '@/server/cart-core';
import { readJson, shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = shopRoute(async (req, db) => Response.json(await quoteCart(db, await readJson(req, cartBody))));
