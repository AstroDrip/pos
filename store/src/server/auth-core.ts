import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../../dashboard/src/server/password.ts';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { ApiError } from './errors.ts';

// Staff login for the web admin. POS accounts and owner dashboard accounts are separate on purpose.

export const SESSION_HOURS = 12;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
const MAX_IP_FAILURES = 30;

export interface StaffUser {
  userId: number;
  displayName: string;
  role: string;
  permissions: ReadonlySet<string>;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Spent on unknown usernames so that they take as long as known ones.
let decoy: Promise<string> | null = null;

async function failures(db: Db, key: string): Promise<number> {
  const [r] = await db.query<{ n: number | string }>('SELECT count(*) AS n FROM commerce.login_attempts WHERE key = $1 AND ok = false AND at > now() - make_interval(mins => $2)', [key, LOCK_MINUTES]);
  return Number(r?.n ?? 0);
}

export type LoginResult = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'locked' };

export async function attemptLogin(db: Db, username: string, password: string, ip: string): Promise<LoginResult> {
  const name = username.trim().toLowerCase().slice(0, 40);
  const keyU = `u:${name}`;
  const keyI = `i:${hashToken(ip).slice(0, 32)}`;
  if ((await failures(db, keyU)) >= MAX_FAILURES || (await failures(db, keyI)) >= MAX_IP_FAILURES) return { ok: false, reason: 'locked' };

  const [user] = await db.query<{ id: number | string; password_hash: string; active: boolean }>('SELECT id, password_hash, active FROM commerce.staff_users WHERE username = $1', [name]);
  decoy ??= hashPassword(randomBytes(16).toString('hex'));
  const good = await verifyPassword(password.slice(0, 200), user?.password_hash ?? (await decoy));
  if (!user || !user.active || !good) {
    await db.batch([
      { text: 'INSERT INTO commerce.login_attempts (key, ok) VALUES ($1, false)', params: [keyU] },
      { text: 'INSERT INTO commerce.login_attempts (key, ok) VALUES ($1, false)', params: [keyI] },
    ]);
    return { ok: false, reason: 'invalid' };
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db.batch([
    { text: 'INSERT INTO commerce.staff_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', params: [hashToken(token), user.id, expiresAt.toISOString()] },
    { text: 'INSERT INTO commerce.login_attempts (key, ok) VALUES ($1, true)', params: [keyU] },
    { text: "INSERT INTO commerce.audit_log (actor, actor_id, action) VALUES ('staff', $1, 'staff.login')", params: [String(user.id)] },
  ]);
  return { ok: true, token, expiresAt };
}

export async function readSession(db: Db, token: string): Promise<StaffUser | null> {
  const rows = await db.query<{ user_id: number | string; display_name: string; role: string; permission: string | null }>(
    `SELECT s.user_id, u.display_name, u.role, p.permission
     FROM commerce.staff_sessions s
     JOIN commerce.staff_users u ON u.id = s.user_id
     LEFT JOIN commerce.staff_role_permissions p ON p.role = u.role
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active = true`,
    [hashToken(token)],
  );
  const first = rows[0];
  if (!first) return null;
  return { userId: Number(first.user_id), displayName: first.display_name, role: first.role, permissions: new Set(rows.flatMap((r) => (r.permission ? [r.permission] : []))) };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query('UPDATE commerce.staff_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

export function requirePermission(user: StaffUser, code: string): void {
  if (!user.permissions.has(code)) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.');
}

export interface RequestFacts {
  method: string;
  origin: string | null;
  host: string | null;
}

function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Every admin API call passes through here. A hidden button is never the permission check. */
export async function authorizeRequest(db: Db, token: string | null, permission: string, facts: RequestFacts): Promise<StaffUser> {
  const isRead = facts.method === 'GET' || facts.method === 'HEAD';
  if (!isRead && !sameOrigin(facts.origin, facts.host)) throw new ApiError(403, 'BAD_ORIGIN', 'This request came from another site.');
  const user = token ? await readSession(db, token) : null;
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in.');
  requirePermission(user, permission);
  return user;
}
