import { nextDay, storeDateTime, storeDayStartUtc } from '../core/store-time';
import { appendAudit } from './audit';
import type { Ctx } from './context';
import { requirePermission } from './users';

// Reading the audit log. Nothing here can change a record.

export interface AuditFilters {
  text?: string;
  userId?: number;
  from?: string;
  to?: string;
  action?: string;
  entity?: string;
  offset: number;
  limit: number;
}

export interface AuditView {
  id: number;
  at: string;
  userId: number | null;
  actor: string | null;
  role: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  screen: string | null;
  related: { type: string; id: string | number } | null;
  status: 'ok' | 'failed';
  details: unknown;
}

export interface AuditFilterChoices {
  actions: string[];
  entities: string[];
  users: { id: number; name: string }[];
}

const MAX_EXPORT = 50_000;

function where(f: AuditFilters): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, ...a: unknown[]) => {
    parts.push(sql);
    args.push(...a);
  };
  if (f.userId) add('a.user_id = ?', f.userId);
  if (f.action) add('a.action = ?', f.action);
  if (f.entity) add('a.entity = ?', f.entity);
  if (f.from) add('a.at >= ?', storeDayStartUtc(f.from));
  if (f.to) add('a.at < ?', storeDayStartUtc(nextDay(f.to)));
  if (f.text) {
    const like = `%${f.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add("(a.details_json LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR a.entity_id LIKE ? ESCAPE '\\')", like, like, like);
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

interface Row {
  id: number;
  at: string;
  user_id: number | null;
  name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details_json: string;
}

function view(r: Row): AuditView {
  const { _m: raw, ...details } = JSON.parse(r.details_json) as Record<string, unknown> & { _m?: Record<string, unknown> };
  const m = raw ?? {};
  return {
    id: r.id,
    at: r.at,
    userId: r.user_id,
    actor: (m.actor as string | null | undefined) ?? r.name,
    role: (m.role as string | null | undefined) ?? null,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    before: m.before ?? null,
    after: m.after ?? null,
    reason: (m.reason as string | undefined) ?? null,
    screen: (m.screen as string | null | undefined) ?? null,
    related: (m.related as AuditView['related'] | undefined) ?? null,
    status: m.status === 'failed' ? 'failed' : 'ok',
    details,
  };
}

const FROM = 'FROM audit_log a LEFT JOIN users u ON u.id = a.user_id';
const SELECT = `SELECT a.id, a.at, a.user_id, u.display_name AS name, a.action, a.entity, a.entity_id, a.details_json ${FROM}`;

export function listAudit(ctx: Ctx, userId: number, f: AuditFilters): { items: AuditView[]; total: number } {
  requirePermission(ctx, userId, 'audit.view');
  const w = where(f);
  const total = (ctx.db.prepare(`SELECT count(*) AS n ${FROM} ${w.sql}`).get(...w.args) as { n: number }).n;
  const rows = ctx.db.prepare(`${SELECT} ${w.sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...w.args, f.limit, f.offset) as Row[];
  return { items: rows.map(view), total };
}

export function auditFilters(ctx: Ctx, userId: number): AuditFilterChoices {
  requirePermission(ctx, userId, 'audit.view');
  const col = (sql: string) => (ctx.db.prepare(sql).all() as { v: string }[]).map((r) => r.v);
  return {
    actions: col('SELECT DISTINCT action AS v FROM audit_log ORDER BY action'),
    entities: col('SELECT DISTINCT entity AS v FROM audit_log ORDER BY entity'),
    users: ctx.db.prepare('SELECT id, display_name AS name FROM users ORDER BY display_name').all() as { id: number; name: string }[],
  };
}

/** One CSV cell. A cell that starts like a formula is made plain text, so a spreadsheet cannot run it. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportAudit(ctx: Ctx, userId: number, f: AuditFilters): string {
  requirePermission(ctx, userId, 'audit.export');
  const w = where(f);
  const rows = (ctx.db.prepare(`${SELECT} ${w.sql} ORDER BY a.id DESC LIMIT ?`).all(...w.args, MAX_EXPORT) as Row[]).map(view);
  const head = ['Time', 'User', 'Role', 'Action', 'Record type', 'Record', 'Result', 'Before', 'After', 'Reason', 'Details'];
  const csv = [head.join(','), ...rows.map((r) => [storeDateTime(r.at), r.actor, r.role, r.action, r.entity, r.entityId, r.status, r.before, r.after, r.reason, r.details].map(csvCell).join(','))].join('\r\n');
  ctx.db.transaction(() => appendAudit(ctx, { userId, action: 'audit.export', entity: 'audit_log', details: { rows: rows.length } }))();
  return csv;
}
