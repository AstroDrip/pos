import { createHash } from 'node:crypto';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { runChecks, type Finding } from './integrity';
import { requirePermission } from './users';

export interface IntegrityRun {
  id: number;
  at: string;
  userId: number;
  findings: (Finding & { fingerprint: string; reviews: { note: string; by: string; at: string }[] })[];
}

const printOf = (f: Finding) => createHash('sha256').update(`${f.checkId}|${f.entityType}|${f.entityId}`).digest('hex');

export function runIntegrity(ctx: Ctx, userId: number): IntegrityRun {
  requirePermission(ctx, userId, 'integrity.view');
  const found = runChecks(ctx);
  const id = ctx.db.transaction(() => {
    const run = Number(ctx.db.prepare('INSERT INTO integrity_runs (at, user_id) VALUES (?, ?)').run(ctx.now(), userId).lastInsertRowid);
    const add = ctx.db.prepare('INSERT INTO integrity_findings (run_id, fingerprint, check_id, severity, entity_type, entity_id, problem, explanation, suggestion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const f of found) add.run(run, printOf(f), f.checkId, f.severity, f.entityType, f.entityId, f.problem, f.explanation, f.suggestion);
    appendAudit(ctx, { userId, action: 'integrity.run', entity: 'integrity_run', entityId: run, details: { findings: found.length, critical: found.filter((f) => f.severity === 'critical').length } });
    return run;
  })();
  return read(ctx, id)!;
}

function read(ctx: Ctx, id: number): IntegrityRun | null {
  const run = ctx.db.prepare('SELECT id, at, user_id AS userId FROM integrity_runs WHERE id = ?').get(id) as Omit<IntegrityRun, 'findings'> | undefined;
  if (!run) return null;
  const rows = ctx.db
    .prepare(`SELECT fingerprint, check_id AS checkId, severity, entity_type AS entityType, entity_id AS entityId, problem, explanation, suggestion FROM integrity_findings WHERE run_id = ?
              ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, id`)
    .all(id) as (Finding & { fingerprint: string })[];
  const notes = ctx.db.prepare('SELECT r.note, u.display_name AS by, r.at FROM integrity_reviews r JOIN users u ON u.id = r.user_id WHERE r.fingerprint = ? ORDER BY r.id');
  return { ...run, findings: rows.map((f) => ({ ...f, reviews: notes.all(f.fingerprint) as { note: string; by: string; at: string }[] })) };
}

export function latestIntegrity(ctx: Ctx, userId: number): IntegrityRun | null {
  requirePermission(ctx, userId, 'integrity.view');
  const last = ctx.db.prepare('SELECT MAX(id) AS id FROM integrity_runs').get() as { id: number | null };
  return last.id === null ? null : read(ctx, last.id);
}

/** A note on a finding. The finding stays until the data is right. */
export function reviewFinding(ctx: Ctx, userId: number, fingerprint: string, note: string): void {
  requirePermission(ctx, userId, 'integrity.view');
  if (!note.trim()) throw new DomainError('VALIDATION', 'Type a note first');
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO integrity_reviews (fingerprint, note, user_id, at) VALUES (?, ?, ?, ?)').run(fingerprint, note.trim(), userId, ctx.now());
    appendAudit(ctx, { userId, action: 'integrity.review', entity: 'integrity_finding', entityId: fingerprint.slice(0, 16), details: { note: note.trim() } });
  })();
}
