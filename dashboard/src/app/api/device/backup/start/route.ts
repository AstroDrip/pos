import { deviceRoute, readJson } from '@/server/device-route';
import { startBody, startUpload } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = deviceRoute(async (req, db, device) => Response.json(await startUpload(db, device, await readJson(req, startBody))));
