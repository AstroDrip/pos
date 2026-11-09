import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers, type Session } from '../main/handlers';
import type { Ctx } from './context';
import { handOverShift, openShift, openShiftId, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { createUser } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let shift: number;
const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
const audit = () => JSON.parse((ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'shift.handover'").get() as { details_json: string }).details_json) as Record<string, unknown>;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  shift = openShift(ctx, u.cashier, 5000);
});
afterEach(() => t.cleanup());

describe('shift handover', () => {
  it('closes and opens in one step; new opening cash equals counted cash', () => {
    const r = handOverShift(ctx, u.cashier, u.supervisor, 5000);
    expect(r.closed).toMatchObject({ shiftId: shift, status: 'closed', countedCash: 5000 });
    expect(openShiftId(ctx)).toBe(r.newShiftId);
    expect(shiftSummary(ctx, r.newShiftId).openingFloat).toBe(5000);
    expect(ctx.db.prepare('SELECT user_id FROM register_shifts WHERE id = ?').get(r.newShiftId)).toEqual({ user_id: u.supervisor });
  });

  it('audit shows both people, expected, counted, difference', () => {
    handOverShift(ctx, u.cashier, u.supervisor, 4900);
    expect(audit()).toMatchObject({ from: 'Cashier', to: 'Supervisor', expected: 5000, counted: 4900, difference: -100 });
  });

  it('a cash difference posts through the normal close rule', () => {
    handOverShift(ctx, u.cashier, u.supervisor, 4900);
    expect(count("SELECT count(*) AS n FROM journal_entries WHERE source_type = 'shift_close'")).toBe(1);
  });

  it('refused to the same person; the shift stays open', () => {
    expect(() => handOverShift(ctx, u.cashier, u.cashier, 5000)).toThrow(/different/i);
    expect(openShiftId(ctx)).toBe(shift);
  });

  it('outgoing needs shift.close, incoming needs shift.open; a refusal changes nothing', () => {
    const nobody = createUser(ctx, u.admin, { username: 'none', displayName: 'None', pin: '3333', roles: [] });
    expect(() => handOverShift(ctx, nobody, u.supervisor, 5000)).toThrow();
    expect(() => handOverShift(ctx, u.cashier, nobody, 5000)).toThrow();
    expect(openShiftId(ctx)).toBe(shift);
    expect(count("SELECT count(*) AS n FROM register_shifts WHERE status = 'closed'")).toBe(0);
  });

  it('no open shift is refused', () => {
    handOverShift(ctx, u.cashier, u.supervisor, 5000);
    ctx.db.prepare("UPDATE register_shifts SET status = 'closed', closed_at = ? WHERE status = 'open'").run(ctx.now());
    expect(() => handOverShift(ctx, u.cashier, u.supervisor, 5000)).toThrow();
  });
});

describe('handover through the app', () => {
  const asCashier = async () => {
    const dispatch = createHandlers(ctx, { printReceipt: async () => undefined });
    const s: Session = { user: null };
    await dispatch('auth.login', { username: 'cash', pin: '1111' }, s);
    return { dispatch, s };
  };

  it('wrong PIN: the shift stays open, and auth.fail is written', async () => {
    const { dispatch, s } = await asCashier();
    expect(await dispatch('shift.handover', { countedCash: 5000, username: 'sup', pin: '0000' }, s)).toMatchObject({ ok: false });
    expect(openShiftId(ctx)).toBe(shift);
    expect(count("SELECT count(*) AS n FROM audit_log WHERE action = 'auth.fail'")).toBe(1);
    expect(s.user?.username).toBe('cash');
  });

  it('switches to the next cashier', async () => {
    const { dispatch, s } = await asCashier();
    expect(await dispatch('shift.handover', { countedCash: 5000, username: 'sup', pin: '2222' }, s)).toMatchObject({ ok: true });
    expect(s.user?.username).toBe('sup');
  });
});
