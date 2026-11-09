import { z } from 'zod';

// Server-only settings. Nothing here may ever be named NEXT_PUBLIC_.

const pg = z.string().regex(/^postgres(ql)?:\/\/[^@\s]+@[^\s]+$/, 'must be a postgresql:// connection string');
const blank = (v: unknown) => (v === '' ? undefined : v);

const schema = z.object({
  DASHBOARD_DATABASE_URL: z.preprocess(blank, pg.optional()),
  DASHBOARD_DEMO_DATABASE_URL: z.preprocess(blank, pg.optional()),
  DEVICE_API_DATABASE_URL: z.preprocess(blank, pg.optional()),
  DASHBOARD_DEMO_MODE: z.preprocess(blank, z.enum(['true', 'false']).default('false')),
});

export interface Env {
  realUrl: string | null;
  demoUrl: string | null;
  deviceUrl: string | null;
  demoMode: boolean;
}

const roleOf = (url: string) => new URL(url).username;

function expectRole(name: string, url: string | undefined, role: string) {
  if (url && roleOf(url) !== role) throw new Error(`${name} must connect as role ${role}. Never give the app the owner connection.`);
}

/** Refuses to start on a wrong setup, so that a mistake is an error page and never the wrong data. */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Bad settings: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  const e = parsed.data;
  expectRole('DASHBOARD_DATABASE_URL', e.DASHBOARD_DATABASE_URL, 'dashboard_app');
  expectRole('DASHBOARD_DEMO_DATABASE_URL', e.DASHBOARD_DEMO_DATABASE_URL, 'dashboard_demo');
  expectRole('DEVICE_API_DATABASE_URL', e.DEVICE_API_DATABASE_URL, 'device_api');
  const demoMode = e.DASHBOARD_DEMO_MODE === 'true';
  if (demoMode && !e.DASHBOARD_DEMO_DATABASE_URL) throw new Error('DASHBOARD_DEMO_MODE is true but DASHBOARD_DEMO_DATABASE_URL is not set');
  return { realUrl: e.DASHBOARD_DATABASE_URL ?? null, demoUrl: demoMode ? e.DASHBOARD_DEMO_DATABASE_URL! : null, deviceUrl: e.DEVICE_API_DATABASE_URL ?? null, demoMode };
}
