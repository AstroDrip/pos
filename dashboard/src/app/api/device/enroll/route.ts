import { clientIp, openRoute, readJson } from '@/server/device-route';
import { enrollBody, enrollDevice } from '@/server/device-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = openRoute(async (req, db) => Response.json(await enrollDevice(db, clientIp(req), await readJson(req, enrollBody))));
