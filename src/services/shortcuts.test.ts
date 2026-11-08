import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from './context';
import { getShortcuts, saveShortcuts } from './shortcuts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let users: ReturnType<typeof seedUsers>;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  users = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('keyboard shortcut settings', () => {
  it('starts with nothing changed', () => {
    expect(getShortcuts(ctx)).toEqual({});
  });

  it('saves changed keys and reads them back', () => {
    saveShortcuts(ctx, users.admin, { 'palette.open': 'F6', 'letter.H': 'B' });
    expect(getShortcuts(ctx)).toEqual({ 'palette.open': 'F6', 'letter.H': 'B' });
  });

  it('drops entries that equal the default', () => {
    saveShortcuts(ctx, users.admin, { 'palette.open': 'Ctrl+K', 'help.open': 'F6' });
    expect(getShortcuts(ctx)).toEqual({ 'help.open': 'F6' });
  });

  it('only a user with settings.manage can change them', () => {
    expect(() => saveShortcuts(ctx, users.cashier, { 'help.open': 'F6' })).toThrow();
    expect(() => saveShortcuts(ctx, users.supervisor, { 'help.open': 'F6' })).toThrow();
    expect(getShortcuts(ctx)).toEqual({});
  });

  it('refuses a bad key and keeps what was saved', () => {
    saveShortcuts(ctx, users.admin, { 'help.open': 'F6' });
    expect(() => saveShortcuts(ctx, users.admin, { 'help.open': 'Ctrl+C' })).toThrow();
    expect(getShortcuts(ctx)).toEqual({ 'help.open': 'F6' });
  });

  it('writes an audit record with the old and new keys', () => {
    saveShortcuts(ctx, users.admin, { 'help.open': 'F6' });
    const row = ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'settings.shortcuts'").get() as { details_json: string };
    expect(row.details_json).toContain('F6');
  });

  it('falls back to the defaults if the stored value is damaged', () => {
    ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('keyboard_shortcuts', 'not json')").run();
    expect(getShortcuts(ctx)).toEqual({});
    ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'keyboard_shortcuts'").run(JSON.stringify({ 'help.open': 'Ctrl+C' }));
    expect(getShortcuts(ctx)).toEqual({});
  });
});
