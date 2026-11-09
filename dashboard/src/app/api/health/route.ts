import { dbFor, deviceDb } from '@/server/db';
import { readEnv } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ping = async (db: { query(t: string): Promise<unknown> } | null) => {
  if (!db) return 'not_configured';
  try {
    await db.query('SELECT 1');
    return 'ok';
  } catch {
    return 'down';
  }
};

/** Says only what is working. No names, hosts or errors. */
export async function GET() {
  try {
    const env = readEnv();
    const [real, demo, device] = await Promise.all([ping(dbFor('real')), ping(dbFor('demo')), ping(deviceDb())]);
    const ok = ![real, demo, device].includes('down') && (real === 'ok' || demo === 'ok');
    return Response.json({ ok, real, demo, device, demoMode: env.demoMode }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'settings' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
