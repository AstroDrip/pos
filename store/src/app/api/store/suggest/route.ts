import { suggest } from '@/server/catalog-core';
import { shopRoute } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = shopRoute(async (req, db) => Response.json(await suggest(db, (new URL(req.url).searchParams.get('q') ?? '').slice(0, 80))));
