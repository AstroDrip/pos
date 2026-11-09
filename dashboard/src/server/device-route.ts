import 'server-only';
import { z } from 'zod';
import type { Db } from './db-types.ts';
import { deviceDb } from './db.ts';
import { ApiError, authenticate, type Device } from './device-core.ts';

const MAX_JSON = 4_000_000;

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

function fail(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.code, message: e.message }, { status: e.status });
  console.error('device api failed', e instanceof Error ? e.name : 'unknown');
  return Response.json({ error: 'UNAVAILABLE', message: 'Try again later.' }, { status: 503 }); // no internal detail, and the POS retries
}

function db(): Db {
  const d = deviceDb();
  if (!d) throw new ApiError(503, 'NOT_CONFIGURED', 'The device service is not configured.');
  return d;
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const size = Number(req.headers.get('content-length') ?? 0);
  if (size > MAX_JSON) throw new ApiError(413, 'TOO_LARGE', 'Request too large.');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Request is not valid.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'INVALID', `Invalid fields: ${[...new Set(r.error.issues.map((i) => i.path[0]))].join(', ')}`);
  return r.data;
}

/** A route that needs a registered device. The store comes from the credential only. */
export function deviceRoute(handler: (req: Request, db: Db, device: Device) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const d = db();
      return await handler(req, d, await authenticate(d, req.headers.get('authorization')));
    } catch (e) {
      return fail(e);
    }
  };
}

/** A route used before a device has a credential: enrolment and recovery. These limit their own attempts. */
export function openRoute(handler: (req: Request, db: Db) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req, db());
    } catch (e) {
      return fail(e);
    }
  };
}
