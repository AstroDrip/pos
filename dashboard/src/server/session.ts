import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { attemptLogin, readSession, revokeSession, SESSION_HOURS, type Scope, type SessionUser } from './auth-core.ts';
import { dbFor } from './db.ts';

const secure = process.env.NODE_ENV === 'production';
const COOKIE = secure ? '__Host-pos_session' : 'pos_session';

function readCookie(value: string | undefined): { scope: Scope; token: string } | null {
  const m = /^(real|demo)\.([\w-]{20,100})$/.exec(value ?? '');
  return m ? { scope: m[1] as Scope, token: m[2]! } : null;
}

/** Once per request. Null for no session, an expired one, or a demo session after demo mode was turned off. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const c = readCookie((await cookies()).get(COOKIE)?.value);
  if (!c) return null;
  const db = dbFor(c.scope);
  return db ? readSession(db, c.scope, c.token) : null;
});

/** Every page's data loader calls this, because layouts do not re-run on navigation. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

export async function logIn(username: string, password: string, ip: string): Promise<'ok' | 'invalid' | 'locked' | 'offline'> {
  const scopes: Scope[] = ['real', 'demo'];
  let answered = false;
  let down = false;
  let locked = false;
  for (const scope of scopes) {
    const db = dbFor(scope);
    if (!db) continue;
    let r;
    try {
      r = await attemptLogin(db, scope, username, password, ip);
    } catch {
      down = true; // one database being down must not open the other: it just cannot log this user in
      continue;
    }
    answered = true;
    if (r.ok) {
      (await cookies()).set(COOKIE, `${r.scope}.${r.token}`, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600 });
      return 'ok';
    }
    if (r.reason === 'locked') locked = true;
  }
  if (locked) return 'locked';
  return down || !answered ? 'offline' : 'invalid';
}

export async function logOut(): Promise<void> {
  const store = await cookies();
  const c = readCookie(store.get(COOKIE)?.value);
  const db = c && dbFor(c.scope);
  if (c && db) await revokeSession(db, c.token);
  store.delete(COOKIE);
}
