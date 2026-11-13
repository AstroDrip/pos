import { readJson, staffRoute } from '@/server/routes';
import { getSettings, settingsPatch, updateSettings } from '@/server/settings-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = staffRoute('settings.manage', async (_req, db) => Response.json(await getSettings(db)));

export const PATCH = staffRoute('settings.manage', async (req, db, user) => Response.json(await updateSettings(db, user, await readJson(req, settingsPatch))));
