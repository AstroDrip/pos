import { DEFAULT_COMBOS, validateOverrides, type ShortcutId, type ShortcutOverrides } from '../core/shortcuts';
import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { requirePermission } from './users';

const KEY = 'keyboard_shortcuts';

/** Keys the admin changed. A damaged or invalid stored value is ignored, so the till always has working keys. */
export function getShortcuts(ctx: Ctx): ShortcutOverrides {
  const row = ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return {};
  try {
    const o = JSON.parse(row.value) as ShortcutOverrides;
    return o && typeof o === 'object' && !Array.isArray(o) && validateOverrides(o) === null ? o : {};
  } catch {
    return {};
  }
}

export function saveShortcuts(ctx: Ctx, userId: number, overrides: ShortcutOverrides): void {
  requirePermission(ctx, userId, 'settings.manage');
  const problem = validateOverrides(overrides);
  if (problem) throw new DomainError('VALIDATION', problem);
  const changed = Object.fromEntries(
    Object.entries(overrides).filter(([id, combo]) => (id.startsWith('letter.') ? combo !== id.slice(7) : combo !== DEFAULT_COMBOS[id as ShortcutId])),
  );
  ctx.db.transaction(() => {
    const before = getShortcuts(ctx);
    ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(changed));
    appendAudit(ctx, { userId, action: 'settings.shortcuts', entity: 'settings', entityId: 0, details: { before, after: changed } });
  })();
}
