import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';

const MAX_FAILED = 5;
const LOCK_MINUTES = 5;
const PIN_RE = /^\d{4,8}$/;

export interface User {
  id: number;
  username: string;
  displayName: string;
  permissions: string[];
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

export function createUser(
  ctx: Ctx,
  actorId: number | null,
  input: { username: string; displayName: string; pin: string; roles: string[] },
): number {
  if (actorId !== null) requirePermission(ctx, actorId, 'user.manage');
  if (!PIN_RE.test(input.pin)) throw new DomainError('VALIDATION', 'PIN must be 4–8 digits');
  if (!input.username.trim()) throw new DomainError('VALIDATION', 'Username is required');
  return ctx.db.transaction(() => {
    const salt = randomBytes(16).toString('hex');
    const id = Number(
      ctx.db
        .prepare(
          'INSERT INTO users (username, display_name, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(input.username.trim(), input.displayName.trim(), hashPin(input.pin, salt), salt, ctx.now()).lastInsertRowid,
    );
    for (const code of input.roles) {
      const role = ctx.db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number } | undefined;
      if (!role) throw new DomainError('VALIDATION', `Unknown role ${code}`);
      ctx.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, role.id);
    }
    appendAudit(ctx, { userId: actorId, action: 'user.create', entity: 'user', entityId: id, details: { username: input.username, roles: input.roles } });
    return id;
  })();
}

export function listUsers(ctx: Ctx): { id: number; username: string; displayName: string; roles: string; active: boolean }[] {
  return (
    ctx.db
      .prepare(
        `SELECT u.id, u.username, u.display_name AS displayName, COALESCE(group_concat(r.code, ', '), '') AS roles, u.active
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id ORDER BY u.username`,
      )
      .all() as { id: number; username: string; displayName: string; roles: string; active: number }[]
  ).map((u) => ({ ...u, active: u.active === 1 }));
}

/** Deactivated users cannot log in or approve anything. Users are never deleted (their records stay attributable). */
export function setUserActive(ctx: Ctx, actorId: number, userId: number, active: boolean): void {
  requirePermission(ctx, actorId, 'user.manage');
  if (actorId === userId && !active) throw new DomainError('VALIDATION', 'You cannot deactivate your own account');
  ctx.db.transaction(() => {
    const u = ctx.db.prepare('SELECT active FROM users WHERE id = ?').get(userId) as { active: number } | undefined;
    if (!u) throw new DomainError('NOT_FOUND', 'User not found');
    if (!active) {
      // Never lock the store out: at least one active administrator must remain.
      const admins = (ctx.db.prepare("SELECT count(*) AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'admin' AND u.active = 1 AND u.id <> ?").get(userId) as { n: number }).n;
      if (admins === 0) throw new DomainError('VALIDATION', 'At least one active administrator must remain');
    }
    ctx.db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, userId);
    appendAudit(ctx, { userId: actorId, action: active ? 'user.activate' : 'user.deactivate', entity: 'user', entityId: userId });
  })();
}

export function userCount(ctx: Ctx): number {
  return (ctx.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
}

export function permissionsOf(ctx: Ctx, userId: number): string[] {
  return (
    ctx.db
      .prepare(
        `SELECT DISTINCT rp.permission_code AS code FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         WHERE ur.user_id = ? AND u.active = 1 ORDER BY 1`,
      )
      .all(userId) as { code: string }[]
  ).map((r) => r.code);
}

export function hasPermission(ctx: Ctx, userId: number, code: string): boolean {
  return permissionsOf(ctx, userId).includes(code);
}

export function requirePermission(ctx: Ctx, userId: number, code: string): void {
  if (!hasPermission(ctx, userId, code)) throw new DomainError('PERMISSION_DENIED', `Not allowed: ${code}`);
}

/**
 * Checks a PIN. Locks the account for a few minutes after repeated failures. Every attempt is audited.
 * Failures are committed before the error is thrown; throwing inside the transaction would roll back
 * the failure counter and the audit row.
 */
export function authenticate(ctx: Ctx, username: string, pin: string): User {
  const outcome = ctx.db.transaction((): User | DomainError => {
    const u = ctx.db
      .prepare('SELECT id, username, display_name, pin_hash, pin_salt, active, failed_logins, locked_until FROM users WHERE username = ?')
      .get(username.trim()) as
      | { id: number; username: string; display_name: string; pin_hash: string; pin_salt: string; active: number; failed_logins: number; locked_until: string | null }
      | undefined;
    const now = ctx.now();
    if (!u || !u.active) {
      appendAudit(ctx, { userId: null, action: 'auth.fail', entity: 'user', details: { username } });
      return new DomainError('AUTH_FAILED', 'Wrong username or PIN');
    }
    if (u.locked_until && u.locked_until > now) {
      return new DomainError('LOCKED', 'Account locked after failed attempts. Try again later.');
    }
    const ok = timingSafeEqual(Buffer.from(hashPin(pin, u.pin_salt), 'hex'), Buffer.from(u.pin_hash, 'hex'));
    if (!ok) {
      const failed = u.failed_logins + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.parse(now) + LOCK_MINUTES * 60_000).toISOString() : null;
      ctx.db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, u.id);
      appendAudit(ctx, { userId: u.id, action: lock ? 'auth.locked' : 'auth.fail', entity: 'user', entityId: u.id });
      return new DomainError('AUTH_FAILED', 'Wrong username or PIN');
    }
    ctx.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
    appendAudit(ctx, { userId: u.id, action: 'auth.login', entity: 'user', entityId: u.id });
    return { id: u.id, username: u.username, displayName: u.display_name, permissions: permissionsOf(ctx, u.id) };
  })();
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}
