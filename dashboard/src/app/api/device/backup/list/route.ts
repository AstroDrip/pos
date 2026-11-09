import { deviceRoute } from '@/server/device-route';
import { listBackups } from '@/server/backup-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = deviceRoute(async (_req, db, device) => Response.json({ backups: await listBackups(db, device) }));
