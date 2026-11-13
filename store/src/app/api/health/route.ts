import { appDb } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const db = appDb();
  if (!db) return Response.json({ ok: false, database: 'not_configured' }, { status: 503 });
  try {
    await db.query('SELECT 1 FROM commerce.store_settings WHERE id = 1');
    return Response.json({ ok: true, database: 'ok' });
  } catch {
    return Response.json({ ok: false, database: 'unavailable' }, { status: 503 });
  }
}
