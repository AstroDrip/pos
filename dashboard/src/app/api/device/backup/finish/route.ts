import { z } from 'zod';
import { deviceRoute, readJson } from '@/server/device-route';
import { finishUpload } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({ backupId: z.string().max(64) });

export const POST = deviceRoute(async (req, db, device) => Response.json(await finishUpload(db, device, (await readJson(req, body)).backupId)));
