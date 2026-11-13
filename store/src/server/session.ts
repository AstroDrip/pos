import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { attemptLogin, readSession, revokeSession, SESSION_HOURS, type StaffUser } from './auth-core.ts';
import { appDb } from './db.ts';

const secure = process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = secure ? '__Host-store_session' : 'store_session';

/** The signed-in staff member, or null. */
export const currentStaff = cache(async (): Promise<StaffUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = appDb();
  return token && db ? readSession(db, token) : null;
});

/** Every admin page calls this, because layouts do not re-run on navigation. */
export async function requireStaff(): Promise<StaffUser> {
  const u = await currentStaff();
  if (!u) redirect('/admin/login');
  return u;
}

export async function logIn(username: string, password: string, ip: string): Promise<'ok' | 'invalid' | 'locked' | 'offline'> {
  const db = appDb();
  if (!db) return 'offline';
  let r;
  try {
    r = await attemptLogin(db, username, password, ip);
  } catch {
    return 'offline';
  }
  if (!r.ok) return r.reason;
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600 });
  return 'ok';
}

export async function logOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const db = appDb();
  if (token && db) await revokeSession(db, token);
  store.delete(SESSION_COOKIE);
}
