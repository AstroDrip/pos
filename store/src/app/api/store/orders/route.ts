import { z } from 'zod';
import { placeOrder, type PlaceOrderInput } from '@/server/order-core';
import { clientIp, readJson, shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// placeOrder checks every field itself, so the body is only read here.
export const POST = shopRoute(async (req, db) => Response.json(await placeOrder(db, (await readJson(req, z.record(z.string(), z.unknown()))) as PlaceOrderInput, clientIp(req)), { status: 201 }));
