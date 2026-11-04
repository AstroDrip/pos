import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/connection';
import type { Ctx } from './context';
import { createUser } from './users';

/** A real on-disk WAL database in a temp folder, with a controllable clock and predictable UUIDs. */
export function makeTestCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'pos-test-'));
  const path = join(dir, 'pos.db');
  const db = openDatabase(path);
  let clock = Date.parse('2026-11-05T08:00:00.000Z');
  let ids = 0;
  const ctx: Ctx = {
    db,
    now: () => new Date(clock).toISOString(),
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  };
  return {
    ctx,
    path,
    advance: (ms: number) => (clock += ms),
    cleanup: () => {
      if (ctx.db.open) ctx.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedUsers(ctx: Ctx) {
  const admin = createUser(ctx, null, { username: 'admin', displayName: 'Admin', pin: '9999', roles: ['admin'] });
  const supervisor = createUser(ctx, admin, { username: 'sup', displayName: 'Supervisor', pin: '2222', roles: ['supervisor'] });
  const cashier = createUser(ctx, admin, { username: 'cash', displayName: 'Cashier', pin: '1111', roles: ['cashier'] });
  return { admin, supervisor, cashier };
}
