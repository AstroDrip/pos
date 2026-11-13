import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { authorizeRequest, type StaffUser } from './auth-core.ts';
import { appDb, deviceDb } from './db.ts';
import { authenticate, type Device } from './device-core.ts';
import { ApiError } from './errors.ts';
import { SESSION_COOKIE } from './session.ts';

const MAX_JSON = 4_000_000;

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

function fail(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ error: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) }, { status: e.status });
  console.error('api failed', e instanceof Error ? e.name : 'unknown', process.env.NODE_ENV === 'production' ? '' : e); // full detail on a developer's computer only
  return Response.json({ error: 'UNAVAILABLE', message: 'Try again later.' }, { status: 503 }); // no internal detail
}

function need(db: Db | null): Db {
  if (!db) throw new ApiError(503, 'NOT_CONFIGURED', 'This service is not configured.');
  return db;
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_JSON) throw new ApiError(413, 'TOO_LARGE', 'Request too large.');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Request is not valid.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'INVALID', `Invalid fields: ${[...new Set(r.error.issues.map((i) => String(i.path[0])))].join(', ')}`);
  return r.data;
}

/** A public shop route. It only ever reaches the customer-safe functions. */
export function shopRoute(handler: (req: Request, db: Db) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req, need(appDb()));
    } catch (e) {
      return fail(e);
    }
  };
}

/** The database for shop pages. A page without one shows the error screen. */
export const shopDb = (): Db => need(appDb());

/** An admin API route. The permission is checked on the server for every call. */
export function staffRoute(permission: string, handler: (req: Request, db: Db, user: StaffUser) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const db = need(appDb());
      const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
      return await handler(req, db, await authorizeRequest(db, token, permission, { method: req.method, origin: req.headers.get('origin'), host: req.headers.get('host') }));
    } catch (e) {
      return fail(e);
    }
  };
}

/** A route that needs a registered POS. */
export function deviceRoute(handler: (req: Request, db: Db, device: Device) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const db = need(deviceDb());
      return await handler(req, db, await authenticate(db, req.headers.get('authorization')));
    } catch (e) {
      return fail(e);
    }
  };
}

/** Used before a POS has a credential. It limits its own attempts. */
export function enrollRoute(handler: (req: Request, db: Db) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req, need(deviceDb()));
    } catch (e) {
      return fail(e);
    }
  };
}
