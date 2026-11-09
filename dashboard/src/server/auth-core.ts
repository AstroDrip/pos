import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db-types.ts';
import { hashPassword, verifyPassword } from './password.ts';

export type Scope = 'real' | 'demo';

export const SESSION_HOURS = 12;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
const MAX_IP_FAILURES = 30;

export interface SessionUser {
  userId: number;
  displayName: string;
  scope: Scope;
  storeId: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Spent on unknown usernames so that they take as long as known ones.
let decoy: Promise<string> | null = null;

async function failures(db: Db, key: string): Promise<number> {
  const [r] = await db.query<{ n: number | string }>(`SELECT count(*) AS n FROM dash_auth.login_attempts WHERE key = $1 AND ok = false AND at > now() - make_interval(mins => $2)`, [key, LOCK_MINUTES]);
  return Number(r?.n ?? 0);
}

export type LoginResult = { ok: true; token: string; expiresAt: Date; scope: Scope } | { ok: false; reason: 'invalid' | 'locked' };

/** Checks a login on one database. The database's role can only see users of its own scope. */
export async function attemptLogin(db: Db, scope: Scope, username: string, password: string, ip: string): Promise<LoginResult> {
  const name = username.trim().toLowerCase().slice(0, 40);
  const keyU = `u:${scope}:${name}`;
  const keyI = `i:${scope}:${hashToken(ip).slice(0, 32)}`;
  if ((await failures(db, keyU)) >= MAX_FAILURES || (await failures(db, keyI)) >= MAX_IP_FAILURES) return { ok: false, reason: 'locked' };

  const [user] = await db.query<{ id: number | string; password_hash: string; active: boolean }>('SELECT id, password_hash, active FROM dash_auth.users WHERE username = $1 AND scope = $2', [name, scope]);
  decoy ??= hashPassword(randomBytes(16).toString('hex'));
  const good = await verifyPassword(password.slice(0, 200), user?.password_hash ?? (await decoy));
  if (!user || !user.active || !good) {
    await db.batch([
      { text: 'INSERT INTO dash_auth.login_attempts (key, ok) VALUES ($1, false)', params: [keyU] },
      { text: 'INSERT INTO dash_auth.login_attempts (key, ok) VALUES ($1, false)', params: [keyI] },
    ]);
    return { ok: false, reason: 'invalid' };
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db.batch([
    { text: 'INSERT INTO dash_auth.sessions (token_hash, user_id, scope, expires_at) VALUES ($1, $2, $3, $4)', params: [hashToken(token), user.id, scope, expiresAt.toISOString()] },
    { text: 'INSERT INTO dash_auth.login_attempts (key, ok) VALUES ($1, true)', params: [keyU] },
  ]);
  return { ok: true, token, expiresAt, scope };
}

export async function readSession(db: Db, scope: Scope, token: string): Promise<SessionUser | null> {
  const [r] = await db.query<{ user_id: number | string; display_name: string; store_id: string }>(
    `SELECT s.user_id, u.display_name, u.store_id FROM dash_auth.sessions s JOIN dash_auth.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.scope = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active = true`,
    [hashToken(token), scope],
  );
  return r ? { userId: Number(r.user_id), displayName: r.display_name, storeId: r.store_id, scope } : null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query('UPDATE dash_auth.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

/** Signs a user out everywhere. */
export async function revokeAllSessions(db: Db, userId: number): Promise<void> {
  await db.query('UPDATE dash_auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
