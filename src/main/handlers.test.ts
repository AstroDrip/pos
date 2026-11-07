import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestCtx } from '../services/test-helpers';
import { createUser } from '../services/users';
import { CHANNELS } from '../shared/ipc';
import { createHandlers, type BackupEnv, type Session } from './handlers';
import { receiptHtml } from './receipt-html';

let t: ReturnType<typeof makeTestCtx>;
let dispatch: ReturnType<typeof createHandlers>;
let printed: number;
let s: Session;

beforeEach(() => {
  t = makeTestCtx();
  printed = 0;
  dispatch = createHandlers(t.ctx, { printReceipt: async () => void printed++ });
  s = { user: null };
});
afterEach(() => t.cleanup());

describe('IPC boundary', () => {
  it('preload allowlist matches the shared channel list exactly', () => {
    const src = readFileSync(join(__dirname, '..', 'preload', 'preload.ts'), 'utf8');
    const list = [...src.matchAll(/^\s+'([a-zA-Z.]+)',$/gm)].map((m) => m[1]);
    expect(list.sort()).toEqual([...CHANNELS].sort());
  });

  it('rejects unknown channels, bad payloads and anonymous calls', async () => {
    expect(await dispatch('fs.readFile', {}, s)).toMatchObject({ ok: false, code: 'BAD_CHANNEL' });
    expect(await dispatch('__proto__', {}, s)).toMatchObject({ ok: false, code: 'BAD_CHANNEL' });
    expect(await dispatch('shift.open', { openingFloat: 1.5 }, s)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await dispatch('shift.open', { openingFloat: 100 }, s)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(await dispatch('catalog.lookup', { code: 'x'.repeat(65) }, s)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('first-run setup works once only', async () => {
    expect(await dispatch('auth.status', null, s)).toMatchObject({ ok: true, data: { needsSetup: true } });
    expect(await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s)).toMatchObject({ ok: true });
    expect(s.user?.username).toBe('owner');
    const s2: Session = { user: null };
    expect(await dispatch('auth.setupAdmin', { username: 'evil', displayName: 'x', pin: '1111' }, s2)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('end-to-end over IPC: create product, open shift, sell, reprint', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    const p = await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250, barcodes: ['6281000000014'] }, s);
    expect(p.ok).toBe(true);
    await dispatch('shift.open', { openingFloat: 0 }, s);
    const look = await dispatch('catalog.lookup', { code: '6281000000014' }, s);
    expect(look).toMatchObject({ ok: true, data: { qty: 1000 } });
    const sale = await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-1', lines: [{ productId: 1, qty: 1000 }], payments: [{ tender: 'cash', amount: 500 }] }, s);
    expect(sale).toMatchObject({ ok: true, data: { invoiceNo: 'INV-00000001', changeGiven: 250 } });
    expect(await dispatch('sale.print', { saleId: 1, copy: true }, s)).toMatchObject({ ok: true });
    expect(printed).toBe(1);
    expect((t.ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(1); // reprint made no sale
  });

  it('a wrong supervisor PIN does not approve a discount', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 }, s);
    // a cashier has no discount rights of their own
    createUser(t.ctx, s.user!.id, { username: 'cashier', displayName: 'C', pin: '1111', roles: ['cashier'] });
    await dispatch('shift.open', { openingFloat: 0 }, s);
    const c: Session = { user: null };
    await dispatch('auth.login', { username: 'cashier', pin: '1111' }, c);
    const r = await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-2', lines: [{ productId: 1, qty: 1000, discount: 50 }], payments: [{ tender: 'cash', amount: 200 }], approver: { username: 'owner', pin: '0000' } }, c);
    expect(r).toMatchObject({ ok: false, code: 'AUTH_FAILED' });
  });
});

describe('receipt HTML', () => {
  it('escapes product names and marks copies', () => {
    const html = receiptHtml(
      { invoiceNo: 'INV-1', uuid: 'u', createdAt: '2026-11-04T20:27:20.451Z', cashier: '<b>', lines: [{ nameAr: 'تفاح', nameEn: '<script>x</script>', qty: 1235, unitPriceIncl: 799, discount: 0, lineIncl: 987, vatRateBp: 1500 }], totalExcl: 858, totalVat: 129, totalIncl: 987, totalDiscount: 0, payments: [{ tender: 'cash', amount: 1000 }], changeGiven: 13 },
      { nameAr: 'متجر', nameEn: 'Store', vatNumber: '' },
      true,
    );
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('COPY');
    expect(html).toContain('9.87');
    expect(html).toContain('NOT A ZATCA TAX INVOICE');
    expect(html).toContain('2026-11-04 23:27'); // Riyadh time, not UTC
  });
});

describe('backup and restore over IPC', () => {
  function fakeEnv(dir: string): BackupEnv & { applied: string[]; key: Buffer | null; file: string } {
    const env = {
      dir,
      appVersion: 't',
      stagingPath: join(dir, 'stage.db'),
      key: null as Buffer | null,
      applied: [] as string[],
      file: '',
      getKey: () => env.key,
      saveNewKey: (k: Buffer) => void (env.key = k),
      newKey: () => randomBytes(32),
      pickBackupFile: async () => env.file || null,
      applyRestore: (p: string) => void env.applied.push(p),
    };
    return env;
  }

  it('key is created once by an admin and the recovery code restores on a fresh install', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-ipc-bak-'));
    const env = fakeEnv(dir);
    const d = createHandlers(t.ctx, { printReceipt: async () => {} }, env);
    await d('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    expect(await d('backup.run', null, s)).toMatchObject({ ok: false, message: /key first/ });
    const k = await d('backup.setupKey', null, s);
    expect(k).toMatchObject({ ok: true });
    expect(await d('backup.setupKey', null, s)).toMatchObject({ ok: false, code: 'CONFLICT' });
    const run = (await d('backup.run', null, s)) as { ok: true; data: { fileName: string } };
    expect(run.ok).toBe(true);
    expect(await d('backup.status', null, s)).toMatchObject({ ok: true, data: { keyConfigured: true, lastVerifiedLocal: { fileName: run.data.fileName } } });

    // New computer: empty database, nobody logged in, no key yet.
    const t2 = makeTestCtx();
    const env2 = fakeEnv(dir);
    env2.file = join(dir, run.data.fileName);
    const d2 = createHandlers(t2.ctx, { printReceipt: async () => {} }, env2);
    const anon: Session = { user: null };
    expect(await d2('restore.prepare', {}, anon)).toMatchObject({ ok: false, message: /recovery code/ });
    const code = (k as { ok: true; data: { recoveryCode: string } }).data.recoveryCode;
    expect(await d2('restore.prepare', { recoveryCode: code }, anon)).toMatchObject({ ok: true, data: { counts: { users: 1 } } });
    expect(await d2('restore.apply', null, anon)).toMatchObject({ ok: true });
    expect(env2.applied).toEqual([env2.stagingPath]);
    expect(env2.key?.equals(env.key!)).toBe(true);
    t2.cleanup();

    // Once users exist, an anonymous session can no longer restore.
    expect(await d('restore.prepare', {}, { user: null })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    rmSync(dir, { recursive: true, force: true });
  }, 30_000); // scrypt key derivation + backup/restore: ~1.5 s alone, timed out once at 7.4 s under full-suite load
});

describe('permission matrix over IPC (audit 5.4: the backend enforces roles, not just hidden buttons)', () => {
  it('a logged-in cashier is refused every manager/admin operation', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 }, s);
    createUser(t.ctx, s.user!.id, { username: 'cashier', displayName: 'C', pin: '1111', roles: ['cashier'] });
    const c: Session = { user: null };
    await dispatch('auth.login', { username: 'cashier', pin: '1111' }, c);
    const day = { fromDay: '2026-11-01', toDay: '2026-11-30' };
    const forbidden: [string, unknown][] = [
      ['catalog.create', { sku: 'X', nameAr: 'س', nameEn: 'X', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1 }],
      ['catalog.setPrice', { productId: 1, priceIncl: 1 }],
      ['catalog.setActive', { productId: 1, active: false, reason: 'x' }],
      ['catalog.aliases', { productId: 1 }],
      ['catalog.setAliases', { productId: 1, aliases: ['x'] }],
      ['supplier.create', { name: 'S' }],
      ['grn.create', { supplierId: 1, lines: [{ productId: 1, qty: 1000, unitCost: 1 }] }],
      ['cash.move', { kind: 'out', amount: 100, reason: 'x' }],
      ['report.stock', { onlyLow: false }],
      ['report.sales', day],
      ['report.voids', day],
      ['report.cashiers', day],
      ['import.dryRun', { kind: 'products', csv: 'sku\n' }],
      ['import.commit', { kind: 'products', csv: 'sku\n', acceptWarnings: true }],
      ['user.list', null],
      ['user.create', { username: 'evil', displayName: 'E', pin: '1234', role: 'admin' }],
      ['user.setActive', { userId: 1, active: false }],
      ['system.health', null],
      ['backup.setupKey', null],
      ['backup.run', null],
      ['restore.prepare', {}],
      ['restore.apply', null],
      ['refund.create', { requestKey: 'abcdefgh-r1', invoiceNo: 'INV-00000001', reason: 'x', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] }],
      ['stock.waste', { requestKey: 'abcdefgh-w1', reason: 'x', lines: [{ productId: 1, qty: 1000 }] }],
      ['stock.count', { requestKey: 'abcdefgh-c1', reason: 'x', lines: [{ productId: 1, countedQty: 0 }] }],
      ['report.refunds', day],
      ['report.adjustments', day],
      ['scale.layouts', null],
      ['dashboard.health', null],
      ['purchase.uninvoiced', {}],
      ['purchase.invoice', { requestKey: 'abcdefgh-p1', supplierId: 1, supplierInvoiceNo: 'X', invoiceDate: '2026-11-05', grnIds: [1], invoiceNet: 100, vatAmount: 0, vatRecoverable: false }],
      ['purchase.return', { requestKey: 'abcdefgh-p2', supplierId: 1, returnDate: '2026-11-05', reason: 'x', lines: [{ productId: 1, qty: 1000 }], creditNet: 100, vatAmount: 0, vatRecoverable: false }],
      ['purchase.opening', { supplierId: 1, amount: 100, asOf: '2026-11-05' }],
      ['purchase.pay', { requestKey: 'abcdefgh-p3', supplierId: 1, amount: 100, method: 'bank', paidOn: '2026-11-05' }],
      ['purchase.statement', { supplierId: 1 }],
      ['purchase.ageing', { asOf: '2026-11-05' }],
      ['purchase.register', day],
      ['purchase.balances', null],
      ['finance.vat', day],
      ['credit.settings', { customerId: 1, creditEnabled: true, creditLimit: null, paymentTermsDays: null }],
      ['credit.receipt', { requestKey: 'abcdefgh-c9', customerId: 1, amount: 100, method: 'bank', allocations: [] }],
      ['credit.reverseReceipt', { receiptId: 1, requestKey: 'abcdefgh-c8', reason: 'x' }],
      ['credit.writeOff', { requestKey: 'abcdefgh-c7', saleId: 1, amount: 100, reason: 'x' }],
      ['credit.applyAdvance', { customerId: 1, allocations: [{ saleId: 1, amount: 1 }] }],
      ['credit.statement', { customerId: 1 }],
      ['credit.ageing', null],
      ['credit.controls', null],
      ['purchase.account', { supplierId: 1 }],
      ['expense.categories', null],
      ['expense.list', day],
      ['expense.summary', day],
      ['expense.create', { requestKey: 'abcdefgh-e1', categoryId: 1, description: 'x', expenseDate: '2026-11-05', gross: 100, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false }],
      ['expense.post', { id: 1 }],
      ['expense.pay', { id: 1, requestKey: 'abcdefgh-e2', amount: 100, method: 'bank', paidOn: '2026-11-05' }],
      ['expense.reverse', { id: 1, reason: 'x' }],
      ['expense.saveRecurring', { name: 'x', categoryId: 1, expectedGross: 100, variableAmount: false, interval: 'monthly', startDate: '2026-11-01', dueDay: 1, vatClass: 'zero', vatRecoverable: false, active: true }],
      ['finance.pl', day],
      ['finance.bs', { asOf: '2026-11-05' }],
      ['finance.tb', day],
      ['finance.gl', { code: '4000', ...day }],
      ['finance.kpis', day],
      ['scale.saveLayout', { name: 'x', spec: 'lit=2 item:4 weight_g:5 plu:3', itemMatches: 'plu', active: true }],
    ];
    for (const [ch, payload] of forbidden) {
      const r = await dispatch(ch, payload, c);
      expect([ch, r]).toEqual([ch, expect.objectContaining({ ok: false, code: 'PERMISSION_DENIED' })]);
    }
    // and the allowed basics still work
    expect(await dispatch('catalog.suggest', { text: 'wat' }, c)).toMatchObject({ ok: true, data: [{ product: { nameEn: 'Water' } }] });
  });

  it('reprints are audited and never create a sale', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 }, s);
    await dispatch('shift.open', { openingFloat: 0 }, s);
    await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-9', lines: [{ productId: 1, qty: 1000 }], payments: [{ tender: 'cash', amount: 250 }] }, s);
    await dispatch('sale.print', { saleId: 1, copy: true }, s);
    await dispatch('sale.print', { saleId: 1, copy: true }, s);
    const n = (sql: string) => (t.ctx.db.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT count(*) AS n FROM audit_log WHERE action = 'sale.reprint'")).toBe(2);
    expect(n('SELECT count(*) AS n FROM sales')).toBe(1);
  });
});

describe('refunds over IPC', () => {
  it('cashier refund with a supervisor PIN prints a credit note; a wrong PIN refunds nothing', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    await dispatch('catalog.create', { sku: 'W', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250 }, s);
    createUser(t.ctx, s.user!.id, { username: 'sup', displayName: 'Sup', pin: '2222', roles: ['supervisor'] });
    createUser(t.ctx, s.user!.id, { username: 'cashier', displayName: 'C', pin: '1111', roles: ['cashier'] });
    const c: Session = { user: null };
    await dispatch('auth.login', { username: 'cashier', pin: '1111' }, c);
    await dispatch('shift.open', { openingFloat: 1000 }, c);
    await dispatch('sale.finalize', { idempotencyKey: 'abcdefgh-s1', lines: [{ productId: 1, qty: 2000 }], payments: [{ tender: 'cash', amount: 500 }] }, c);
    expect(await dispatch('refund.find', { invoiceNo: 'inv-00000001' }, c)).toMatchObject({ ok: true, data: { withinWindow: true, lines: [{ remainingQty: 2000 }] } });
    const base = { invoiceNo: 'INV-00000001', reason: 'Wrong item', lines: [{ saleLineNo: 1, qty: 1000, restock: true }] };
    expect(await dispatch('refund.create', { ...base, requestKey: 'abcdefgh-r2', approver: { username: 'sup', pin: '0000' } }, c)).toMatchObject({ ok: false, code: 'AUTH_FAILED' });
    expect(await dispatch('refund.create', { ...base, requestKey: 'abcdefgh-r3', approver: { username: 'sup', pin: '2222' } }, c)).toMatchObject({ ok: true, data: { refundNo: 'CN-00000001', totalIncl: 250 } });
    const before = printed;
    expect(await dispatch('refund.print', { refundId: 1, copy: false }, c)).toMatchObject({ ok: true });
    expect(printed).toBe(before + 1);
    expect(await dispatch('shift.current', null, c)).toMatchObject({ ok: true, data: { cashRefunds: 250, expectedCash: 1000 + 500 - 250 } });
    expect((t.ctx.db.prepare('SELECT count(*) AS n FROM refunds').get() as { n: number }).n).toBe(1);
  });
});

describe('BUG-010: audit-log tampering is detected by the app', () => {
  it('system.health reports a broken hash chain after a row is forged outside the app', async () => {
    await dispatch('auth.setupAdmin', { username: 'owner', displayName: 'Owner', pin: '4321' }, s);
    expect(await dispatch('system.health', null, s)).toMatchObject({ ok: true, data: { auditChainOk: true } });
    // Someone with the database file inserts a fake audit row (UPDATE/DELETE are blocked by triggers, INSERT is not).
    t.ctx.db.prepare("INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash) VALUES ('2026-01-01', NULL, 'fake', 'x', NULL, '{}', 'x', 'y')").run();
    expect(await dispatch('system.health', null, s)).toMatchObject({ ok: true, data: { auditChainOk: false } });
  });
});
