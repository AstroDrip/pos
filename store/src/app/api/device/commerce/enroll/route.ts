import { enrollBody, enrollDevice } from '@/server/device-core';
import { clientIp, enrollRoute, readJson } from '@/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = enrollRoute(async (req, db) => Response.json(await enrollDevice(db, clientIp(req), await readJson(req, enrollBody))));
