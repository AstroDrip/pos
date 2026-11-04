import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestCtx } from '../services/test-helpers';
import { createUser } from '../services/users';
import { CHANNELS } from '../shared/ipc';
import { createHandlers, type Session } from './handlers';
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
      { invoiceNo: 'INV-1', uuid: 'u', createdAt: 't', cashier: '<b>', lines: [{ nameAr: 'تفاح', nameEn: '<script>x</script>', qty: 1235, unitPriceIncl: 799, discount: 0, lineIncl: 987, vatRateBp: 1500 }], totalExcl: 858, totalVat: 129, totalIncl: 987, totalDiscount: 0, payments: [{ tender: 'cash', amount: 1000 }], changeGiven: 13 },
      { nameAr: 'متجر', nameEn: 'Store', vatNumber: '' },
      true,
    );
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&#60;script&#62;');
    expect(html).toContain('COPY');
    expect(html).toContain('9.87');
    expect(html).toContain('NOT A ZATCA TAX INVOICE');
  });
});
