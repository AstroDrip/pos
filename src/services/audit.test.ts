import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendAudit, redact, verifyAuditChain } from './audit';
import { createProduct, setPrice } from './catalog';
import type { Ctx } from './context';
import { updateCustomerCredit } from './credit';
import { createCustomer, createSupplier, updateSupplier } from './parties';
import { BLANK_STORE, saveStoreDetails } from './store-details';
import { closeShift, openShift, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { hasPermission } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
type Row = { id: number; action: string; details_json: string };
const last = (action: string) => {
  const r = ctx.db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action) as Row | undefined;
  return r ? (JSON.parse(r.details_json) as Record<string, unknown> & { _m: Record<string, unknown> }) : undefined;
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('what every record holds', () => {
  it('every new row has actor, role, device, shift, status under _m', () => {
    const shift = openShift(ctx, u.cashier, 0);
    ctx.screen = 'sell';
    appendAudit(ctx, { userId: u.cashier, action: 'test.thing', entity: 'x', details: { a: 1 } });
    const d = last('test.thing')!;
    expect(d.a).toBe(1);
    expect(d._m).toMatchObject({ actor: 'Cashier', role: 'cashier', screen: 'sell', shift, status: 'ok' });
    expect(typeof d._m.device).toBe('string');
  });

  it('role is the role at that moment', () => {
    appendAudit(ctx, { userId: u.cashier, action: 'test.role', entity: 'x' });
    ctx.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(u.cashier);
    expect(last('test.role')!._m.role).toBe('cashier');
  });

  it('a record with no user still saves', () => {
    appendAudit(ctx, { userId: null, action: 'test.system', entity: 'x' });
    expect(last('test.system')!._m).toMatchObject({ actor: null, role: null });
  });

  it('before, after, reason and related are kept', () => {
    appendAudit(ctx, { userId: u.admin, action: 'test.full', entity: 'x', before: { p: 1 }, after: { p: 2 }, reason: 'because', related: { type: 'sale', id: 9 } });
    expect(last('test.full')!._m).toMatchObject({ before: { p: 1 }, after: { p: 2 }, reason: 'because', related: { type: 'sale', id: 9 } });
  });

  it('old rows still verify', () => {
    const oldShape = ctx.db.prepare("SELECT count(*) AS n FROM audit_log").get() as { n: number };
    expect(oldShape.n).toBeGreaterThan(0);
    appendAudit(ctx, { userId: u.admin, action: 'test.after', entity: 'x' });
    expect(verifyAuditChain(ctx)).toBeNull();
  });
});

describe('redaction', () => {
  it('removes secrets at any depth, in lists too, in any case', () => {
    expect(redact({ pin: '1', PIN: '2', password: 'x', user_pin: '3', secret: 'x', apiToken: 'x', privateKey: 'x', csid: 'x', keep: 1, list: [{ pin: '4', ok: 2 }], deep: { a: { token: 'x', b: 3 } } }))
      .toEqual({ keep: 1, list: [{ ok: 2 }], deep: { a: { b: 3 } } });
  });

  it('leaves look-alike names and record references alone', () => {
    const fine = { monkey: 1, spinner: 2, billKey: 'b', requestKey: 'r', idempotencyKey: 'i' };
    expect(redact(fine)).toEqual(fine);
  });

  it('a secret passed in details is never stored', () => {
    appendAudit(ctx, { userId: u.admin, action: 'test.secret', entity: 'x', details: { pin: '1234' }, before: { password: 'x' } });
    const raw = (ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'test.secret'").get() as { details_json: string }).details_json;
    expect(raw).not.toContain('1234');
    expect(raw).not.toContain('password');
  });
});

describe('who may do what', () => {
  it('only admin has the new permissions', () => {
    for (const p of ['audit.view', 'audit.export', 'integrity.view']) {
      expect(hasPermission(ctx, u.admin, p), p).toBe(true);
      expect(hasPermission(ctx, u.supervisor, p), p).toBe(false);
      expect(hasPermission(ctx, u.cashier, p), p).toBe(false);
    }
  });

  it('a direct UPDATE or DELETE on the log is refused', () => {
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/immutable/i);
    expect(() => ctx.db.prepare('DELETE FROM audit_log').run()).toThrow(/immutable/i);
  });

  it('a tampered row is found', () => {
    appendAudit(ctx, { userId: u.admin, action: 'test.t', entity: 'x' });
    const id = (ctx.db.prepare("SELECT id FROM audit_log WHERE action = 'test.t'").get() as { id: number }).id;
    ctx.db.exec('DROP TRIGGER trg_audit_log_no_update');
    ctx.db.prepare("UPDATE audit_log SET details_json = '{}' WHERE id = ?").run(id);
    expect(verifyAuditChain(ctx)).toBe(id);
  });
});

describe('old and new values', () => {
  it('a price change shows old and new, who and when', () => {
    const id = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
    setPrice(ctx, u.admin, id, 1200);
    expect(last('product.price')!._m).toMatchObject({ before: { price: 1000 }, after: { price: 1200 }, actor: 'Admin' });
  });

  it('a supplier edit shows what it was', () => {
    const id = createSupplier(ctx, u.admin, { name: 'Farm' });
    updateSupplier(ctx, u.admin, id, { name: 'New Farm' });
    expect(last('supplier.update')!._m).toMatchObject({ before: { name: 'Farm' }, after: { name: 'New Farm' } });
  });

  it('customer credit settings show old and new', () => {
    const id = createCustomer(ctx, u.admin, { name: 'Amal' });
    updateCustomerCredit(ctx, u.admin, { customerId: id, creditEnabled: true, creditLimit: 5000, paymentTermsDays: 30 });
    expect(last('customer.credit_settings')!._m).toMatchObject({ before: { enabled: false }, after: { enabled: true, limit: 5000 } });
  });

  it('store details show what changed', () => {
    saveStoreDetails(ctx, u.admin, { ...BLANK_STORE, nameEn: 'Made Up Shop' });
    expect(last('settings.store_details')!._m).toMatchObject({ before: { nameEn: '' }, after: { nameEn: 'Made Up Shop' } });
  });

  it('closing a shift with a difference writes its own record', () => {
    const shift = openShift(ctx, u.cashier, 1000);
    const expected = shiftSummary(ctx, shift).expectedCash;
    closeShift(ctx, u.cashier, expected - 50);
    expect(last('shift.cash_difference')).toMatchObject({ expected, counted: expected - 50, difference: -50 });
  });

  it('closing with no difference writes no such record', () => {
    const shift = openShift(ctx, u.cashier, 1000);
    closeShift(ctx, u.cashier, shiftSummary(ctx, shift).expectedCash);
    expect(last('shift.cash_difference')).toBeUndefined();
  });
});
