import { z } from 'zod';

// Server-only settings. Nothing here may ever be named NEXT_PUBLIC_.

const pg = z.string().regex(/^postgres(ql)?:\/\/[^@\s]+@[^\s]+$/, 'must be a postgresql:// connection string');
const blank = (v: unknown) => (v === '' ? undefined : v);

const schema = z.object({
  STORE_APP_DATABASE_URL: z.preprocess(blank, pg.optional()),
  STORE_DEVICE_DATABASE_URL: z.preprocess(blank, pg.optional()),
  STORE_DISPLAY_NAME: z.preprocess(blank, z.string().max(80).default('Online Store')),
  STORE_IMAGE_BASE_URL: z.preprocess(blank, z.url().optional()),
  /** 1 = run on a built-in throwaway database with made-up data, for looking at the design. Ignored when a real database is set. */
  STORE_DEMO: z.preprocess(blank, z.enum(['0', '1']).optional()),
  /** Password for the demo staff account (username demo). Without it there is no staff account in the demo. */
  STORE_DEMO_PASSWORD: z.preprocess(blank, z.string().min(10).max(200).optional()),
});

export interface Env {
  appUrl: string | null;
  deviceUrl: string | null;
  displayName: string;
  imageBaseUrl: string | null;
  demo: boolean;
  demoPassword: string | null;
}

function expectRole(name: string, url: string | undefined, role: string) {
  if (url && new URL(url).username !== role) throw new Error(`${name} must connect as role ${role}. Never give the app the owner connection.`);
}

/** Refuses to start on a wrong setup, so that a mistake is an error page and never the wrong access. */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Bad settings: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  const e = parsed.data;
  expectRole('STORE_APP_DATABASE_URL', e.STORE_APP_DATABASE_URL, 'store_app');
  expectRole('STORE_DEVICE_DATABASE_URL', e.STORE_DEVICE_DATABASE_URL, 'store_device');
  const demo = e.STORE_DEMO === '1' && !e.STORE_APP_DATABASE_URL && !e.STORE_DEVICE_DATABASE_URL;
  return {
    appUrl: e.STORE_APP_DATABASE_URL ?? null,
    deviceUrl: e.STORE_DEVICE_DATABASE_URL ?? null,
    displayName: e.STORE_DISPLAY_NAME,
    imageBaseUrl: e.STORE_IMAGE_BASE_URL?.replace(/\/$/, '') ?? null,
    demo,
    demoPassword: demo ? (e.STORE_DEMO_PASSWORD ?? null) : null,
  };
}
