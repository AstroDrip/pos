import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storeDateTime } from '../core/store-time';
import { openDatabase } from '../db/connection';
import { appendAudit, verifyAuditChain } from './audit';
import { auditFilters, csvCell, exportAudit, listAudit } from './audit-view';
import { createBackup, installRestore, prepareRestore } from './backup';
import { createProduct } from './catalog';
import type { Ctx } from './context';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { createRefund } from './refunds';
import { finalizeSale } from './sales';
import { openShift } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const page = { offset: 0, limit: 100 };
const add = (action: string, userId: number, entity = 'x') => appendAudit(ctx, { userId, action, entity, entityId: 7, details: { note: `about ${action}` } });

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('reading the log', () => {
  it('lists newest first and pages', () => {
    add('test.a', u.admin);
    t.advance(1000);
    add('test.b', u.admin);
    const r = listAudit(ctx, u.admin, { offset: 0, limit: 1, action: 'test.b' });
    expect(r.items.map((i) => i.action)).toEqual(['test.b']);
    const all = listAudit(ctx, u.admin, page);
    expect(all.items[0]!.action).toBe('test.b');
    expect(all.total).toBeGreaterThan(2);
    expect(listAudit(ctx, u.admin, { offset: 1, limit: 1 }).items[0]!.action).toBe('test.a');
  });

  it('each filter narrows the list', () => {
    add('test.a', u.admin, 'alpha');
    add('test.b', u.cashier, 'beta');
    expect(listAudit(ctx, u.admin, { ...page, action: 'test.a' }).items).toHaveLength(1);
    expect(listAudit(ctx, u.admin, { ...page, entity: 'beta' }).items).toHaveLength(1);
    expect(listAudit(ctx, u.admin, { ...page, userId: u.cashier, action: 'test.b' }).items).toHaveLength(1);
    expect(listAudit(ctx, u.admin, { ...page, text: 'about test.a' }).items).toHaveLength(1);
    expect(listAudit(ctx, u.admin, { ...page, from: '2030-01-01', to: '2030-01-02' }).items).toHaveLength(0);
    expect(listAudit(ctx, u.admin, { ...page, from: '2026-11-05', to: '2026-11-05', action: 'test.a' }).items).toHaveLength(1);
  });

  it('search text is not a pattern', () => {
    add('test.a', u.admin);
    expect(listAudit(ctx, u.admin, { ...page, text: '%%%' }).items).toHaveLength(0);
  });

  it('shows who, role, before and after', () => {
    appendAudit(ctx, { userId: u.cashier, action: 'test.c', entity: 'x', before: { a: 1 }, after: { a: 2 }, reason: 'why', related: { type: 'sale', id: 'INV-1' } });
    expect(listAudit(ctx, u.admin, { ...page, action: 'test.c' }).items[0]).toMatchObject({ actor: 'Cashier', role: 'cashier', before: { a: 1 }, after: { a: 2 }, reason: 'why', related: { type: 'sale', id: 'INV-1' }, status: 'ok' });
  });

  it("an old row reads with empty extras and its user's current name", () => {
    const row = listAudit(ctx, u.admin, { ...page, action: 'user.create' }).items[0]!;
    expect(row.actor).toBeTruthy();
    expect(row.status).toBe('ok');
    ctx.db.exec('DROP TRIGGER trg_audit_log_no_update');
    ctx.db.prepare("UPDATE audit_log SET details_json = '{}' WHERE action = 'test.none'").run();
    ctx.db.prepare("INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash) VALUES (?, ?, 'test.old', 'x', NULL, '{}', 'p', 'old-row-hash')").run(ctx.now(), u.cashier);
    expect(listAudit(ctx, u.admin, { ...page, action: 'test.old' }).items[0]).toMatchObject({ actor: 'Cashier', role: null, before: null, after: null, reason: null, related: null, screen: null, status: 'ok' });
  });

  it('lists the choices for the filters', () => {
    add('test.a', u.admin, 'alpha');
    const f = auditFilters(ctx, u.admin);
    expect(f.actions).toContain('test.a');
    expect(f.entities).toContain('alpha');
    expect(f.users.map((x) => x.name)).toContain('Admin');
  });

  it('cashier and supervisor are refused for list and export', () => {
    for (const who of [u.cashier, u.supervisor]) {
      expect(() => listAudit(ctx, who, page)).toThrow();
      expect(() => auditFilters(ctx, who)).toThrow();
      expect(() => exportAudit(ctx, who, page)).toThrow();
    }
  });

  it('a refund links to its original sale', () => {
    const item = createProduct(ctx, u.admin, { sku: 'A1', nameEn: 'Apple', nameAr: 'تفاح', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1000 });
    receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'Farm' }), lines: [{ productId: item, qty: 10_000, unitCost: 500 }] });
    openShift(ctx, u.cashier, 0);
    const sale = finalizeSale(ctx, u.cashier, { idempotencyKey: 'audit-view-1', lines: [{ productId: item, qty: 1000 }], payments: [{ tender: 'cash', amount: 1000 }] });
    createRefund(ctx, u.supervisor, { requestKey: 'audit-view-r', invoiceNo: sale.invoiceNo, reason: 'Wrong item', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] });
    expect(listAudit(ctx, u.admin, { ...page, action: 'sale.refund' }).items[0]!.related).toEqual({ type: 'sale', id: sale.invoiceNo });
  });
});

describe('exporting the log', () => {
  it('gives CSV and is itself recorded', () => {
    add('test.a', u.admin);
    const csv = exportAudit(ctx, u.admin, { ...page, action: 'test.a' });
    expect(csv.split('\r\n')[0]).toContain('Action');
    expect(csv.split('\r\n')[1]).toContain(storeDateTime(ctx.now())); // the same store time the screen shows
    expect(csv).toContain('test.a');
    expect(listAudit(ctx, u.admin, { ...page, action: 'audit.export' }).items).toHaveLength(1);
  });

  it('stops at 50,000 rows', () => {
    ctx.db.transaction(() => {
      const row = ctx.db.prepare("INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash) VALUES (?, NULL, 'bulk', 'x', NULL, '{}', 'p', ?)");
      for (let i = 0; i < 50_010; i++) row.run(ctx.now(), `bulk-${i}`);
    })();
    expect(exportAudit(ctx, u.admin, { ...page, action: 'bulk' }).trimEnd().split('\r\n')).toHaveLength(50_001);
  }, 60_000);

  it('escapes cells that a spreadsheet would run as a formula', () => {
    for (const bad of ['=1+1', '+1', '-1', '@x', '\t=1', '\r=1']) expect(csvCell(bad).replace(/^"|"$/g, '')).toBe(`'${bad}`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });
});

describe('backup', () => {
  it('backup and restore keep every audit row and the chain verifies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-aud-'));
    try {
      const key = randomBytes(32);
      add('test.a', u.admin);
      const before = (ctx.db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;
      const r = createBackup(ctx, { dir, masterKey: key, appVersion: 'test', trigger: 'manual', userId: u.admin });
      const live = join(dir, 'new.db');
      openDatabase(live).close();
      const staging = join(dir, 'stage.db');
      expect(prepareRestore(join(dir, r.fileName), key, staging).verifiedCounts.audit_log).toBeGreaterThanOrEqual(before);
      installRestore(live, staging, 'test');
      const db = openDatabase(live);
      expect((db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n).toBeGreaterThanOrEqual(before);
      expect(verifyAuditChain({ ...ctx, db })).toBeNull();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
