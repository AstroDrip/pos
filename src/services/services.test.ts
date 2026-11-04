import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ean13CheckDigit } from '../core/scale-barcode';
import { computeInvoice } from '../core/vat';
import { openDatabase } from '../db/connection';
import { appendAudit, verifyAuditChain } from './audit';
import { createProduct, lookup, qtyForLabelPrice, setPrice } from './catalog';
import { DomainError, type Ctx } from './context';
import { receiveGoods, stockDrift } from './inventory';
import { trialBalance, unbalancedEntries } from './ledger';
import { finalizeSale, receiptData } from './sales';
import { closeShift, openShift, recordCashMovement, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { authenticate, createUser } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let apples: number; // weighed, SAR 7.99/kg
let water: number; // piece, SAR 2.50
let supplierId: number;

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  apples = createProduct(ctx, u.admin, { sku: 'APL', nameAr: 'تفاح', nameEn: 'Apples', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 799, plu: '123' });
  water = createProduct(ctx, u.admin, { sku: 'WAT', nameAr: 'ماء', nameEn: 'Water 1.5L', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 250, barcodes: ['6281000000014'] });
  supplierId = Number(ctx.db.prepare("INSERT INTO suppliers (name, created_at) VALUES ('Farm Co', ?)").run(ctx.now()).lastInsertRowid);
  receiveGoods(ctx, u.admin, { supplierId, lines: [{ productId: apples, qty: 50_000, unitCost: 500 }, { productId: water, qty: 100_000, unitCost: 150 }] });
});
afterEach(() => t.cleanup());

const key = (n: number) => `bill-key-${String(n).padStart(4, '0')}`;
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const balanceOf = (code: string) => {
  const r = trialBalance(ctx).find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const expectDomain = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}`);
};

describe('users and audit', () => {
  it('authenticates with the right PIN only', () => {
    expect(authenticate(ctx, 'cash', '1111').permissions).toContain('sale.create');
    expectDomain(() => authenticate(ctx, 'cash', '0000'), 'AUTH_FAILED');
  });

  it('regression: failed logins are committed and lock the account (not rolled back)', () => {
    for (let i = 0; i < 5; i++) expectDomain(() => authenticate(ctx, 'cash', '0000'), 'AUTH_FAILED');
    expectDomain(() => authenticate(ctx, 'cash', '1111'), 'LOCKED');
    expect(count("audit_log WHERE action = 'auth.locked'")).toBe(1);
    t.advance(6 * 60_000);
    expect(authenticate(ctx, 'cash', '1111').id).toBe(u.cashier);
  });

  it('cashier cannot manage users or products', () => {
    expectDomain(() => createUser(ctx, u.cashier, { username: 'x', displayName: 'x', pin: '1234', roles: [] }), 'PERMISSION_DENIED');
    expectDomain(() => setPrice(ctx, u.cashier, water, 1), 'PERMISSION_DENIED');
  });

  it('audit chain verifies and detects a forged row', () => {
    expect(verifyAuditChain(ctx)).toBeNull();
    appendAudit(ctx, { userId: u.admin, action: 'test', entity: 'x' });
    expect(verifyAuditChain(ctx)).toBeNull();
    ctx.db.prepare("INSERT INTO audit_log (at, user_id, action, entity, entity_id, details_json, prev_hash, hash) VALUES ('t', NULL, 'forged', 'x', NULL, '{}', 'bad', 'bad')").run();
    expect(verifyAuditChain(ctx)).not.toBeNull();
  });

  it('audit log cannot be edited or deleted', () => {
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM audit_log').run()).toThrow(/immutable/);
  });
});

describe('catalog lookup', () => {
  beforeEach(() => {
    ctx.db.prepare("INSERT INTO scale_barcode_formats (prefix, item_digits, value_digits, embedded) VALUES ('21', 5, 5, 'weight'), ('22', 5, 5, 'price')").run();
  });
  const ean = (s: string) => s + ean13CheckDigit(s);

  it('finds by barcode, PLU and SKU', () => {
    expect(lookup(ctx, '6281000000014')).toMatchObject({ source: 'barcode', qty: 1000, product: { id: water } });
    expect(lookup(ctx, '123')).toMatchObject({ source: 'plu', qty: 0, product: { id: apples } });
    expect(lookup(ctx, 'WAT')).toMatchObject({ source: 'sku', product: { id: water } });
    expect(lookup(ctx, 'nope')).toBeNull();
  });

  it('reads weight and price from scale labels', () => {
    expect(lookup(ctx, ean('210012301235'))).toMatchObject({ source: 'scale', qty: 1235, product: { id: apples } });
    // label price 9.87 at 7.99/kg -> 1.235 kg
    expect(lookup(ctx, ean('220012300987'))).toMatchObject({ source: 'scale', qty: 1235 });
  });

  it('rejects a price label that no weight can produce at the current price', () => {
    // At 7.99/kg every halala amount is reachable (1 g = 0.799 halala), so use a dearer item:
    // at 49.99/kg, 1 g costs 5 halalas and a 0.02 label is impossible.
    expect(qtyForLabelPrice(799, 1)).toBe(1);
    expect(qtyForLabelPrice(4999, 2)).toBeNull();
    createProduct(ctx, u.admin, { sku: 'MEAT', nameAr: 'لحم', nameEn: 'Lamb', unitCode: 'KG', sellMode: 'weight', vatRateBp: 1500, priceIncl: 4999, plu: '456' });
    expectDomain(() => lookup(ctx, ean('220045600002')), 'VALIDATION');
  });

  it('rejects duplicate barcodes', () => {
    expectDomain(
      () => createProduct(ctx, u.admin, { sku: 'W2', nameAr: 'ماء', nameEn: 'Water', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1, barcodes: ['6281000000014'] }),
      'CONFLICT',
    );
    expect(count("products WHERE sku = 'W2'")).toBe(0); // whole create rolled back
  });
});

describe('sale finalization', () => {
  beforeEach(() => {
    openShift(ctx, u.cashier, 10_000);
  });

  it('commits sale, payments, stock, ledger and audit together', () => {
    const r = finalizeSale(ctx, u.cashier, {
      idempotencyKey: key(1),
      lines: [{ productId: apples, qty: 1235 }, { productId: water, qty: 3000 }],
      payments: [{ tender: 'cash', amount: 2000 }],
    });
    expect(r).toMatchObject({ invoiceNo: 'INV-00000001', totalIncl: 1737, changeGiven: 263, replayed: false });
    expect(count('sale_lines')).toBe(2);
    expect(stockDrift(ctx)).toEqual([]);
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(-balanceOf('4000') - balanceOf('2200')).toBe(1737); // revenue + VAT = total
    expect(balanceOf('1010')).toBe(1737); // net cash in drawer
    // COGS at average cost: 1.235 kg x 5.00 = 6.18 (rounded), 3 x 1.50 = 4.50
    expect(balanceOf('5000')).toBe(618 + 450);
    const rec = receiptData(ctx, r.saleId);
    expect(rec.lines[0]).toMatchObject({ nameEn: 'Apples', qty: 1235, lineIncl: 987 });
    expect(rec.payments).toEqual([{ tender: 'cash', amount: 2000 }]);
  });

  it('snapshots price: a later price change does not alter the sale', () => {
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'card', amount: 250 }] });
    setPrice(ctx, u.admin, water, 999);
    expect(receiptData(ctx, r.saleId).totalIncl).toBe(250);
  });

  it('retry with the same key returns the same sale and creates nothing new', () => {
    const input = { idempotencyKey: key(7), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'cash' as const, amount: 250 }] };
    const a = finalizeSale(ctx, u.cashier, input);
    const b = finalizeSale(ctx, u.cashier, input);
    expect(b).toMatchObject({ saleId: a.saleId, invoiceNo: a.invoiceNo, replayed: true });
    expect(count('sales')).toBe(1);
    expect(count("stock_movements WHERE reason = 'sale'")).toBe(1);
    expect(count("journal_entries WHERE source_type = 'sale'")).toBe(1);
  });

  it('a failure rolls back everything, including the invoice counter', () => {
    ctx.db.prepare("UPDATE settings SET value = 'block' WHERE key = 'negative_stock_policy'").run();
    expectDomain(
      () => finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 1000 }, { productId: apples, qty: 999_000 }], payments: [{ tender: 'cash', amount: 1_000_000 }] }),
      'NEGATIVE_STOCK',
    );
    expect(count('sales')).toBe(0);
    expect(count("stock_movements WHERE reason = 'sale'")).toBe(0);
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(2), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'cash', amount: 250 }] });
    expect(r.invoiceNo).toBe('INV-00000001'); // no gap in numbering
  });

  it('allow policy: sells into negative stock and reports it', () => {
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: apples, qty: 60_000 }], payments: [{ tender: 'cash', amount: 50_000 }] });
    expect(r.negativeStockProducts).toEqual([apples]);
    expect(stockDrift(ctx)).toEqual([]);
  });

  it('discounts need permission or supervisor approval', () => {
    const base = { lines: [{ productId: water, qty: 1000, discount: 50 }], payments: [{ tender: 'cash' as const, amount: 200 }] };
    expectDomain(() => finalizeSale(ctx, u.cashier, { ...base, idempotencyKey: key(1) }), 'PERMISSION_DENIED');
    expectDomain(() => finalizeSale(ctx, u.cashier, { ...base, idempotencyKey: key(2), discountApproverId: u.cashier }), 'PERMISSION_DENIED');
    const r = finalizeSale(ctx, u.cashier, { ...base, idempotencyKey: key(3), discountApproverId: u.supervisor });
    expect(r.totalIncl).toBe(200);
  });

  it('validates payments', () => {
    const lines = [{ productId: water, qty: 1000 }];
    expectDomain(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines, payments: [{ tender: 'cash', amount: 249 }] }), 'INSUFFICIENT_PAYMENT');
    expectDomain(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(2), lines, payments: [{ tender: 'card', amount: 300 }] }), 'VALIDATION');
    expectDomain(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(3), lines: [{ productId: water, qty: 1500 }], payments: [{ tender: 'cash', amount: 500 }] }), 'VALIDATION');
  });

  it('finalized sales cannot be edited or deleted', () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'cash', amount: 250 }] });
    expect(() => ctx.db.prepare('UPDATE sales SET total_incl = 1').run()).toThrow(/immutable/);
    expect(() => ctx.db.prepare('DELETE FROM sale_lines').run()).toThrow(/immutable/);
    expect(() => ctx.db.prepare('UPDATE journal_lines SET debit = debit + 1').run()).toThrow(/immutable/);
  });

  it('requires an open shift', () => {
    closeShift(ctx, u.cashier, 10_000);
    expectDomain(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'cash', amount: 250 }] }), 'NO_OPEN_SHIFT');
  });
});

describe('shifts', () => {
  it('reconciles expected cash and posts over/short', () => {
    openShift(ctx, u.cashier, 10_000);
    expectDomain(() => openShift(ctx, u.cashier, 0), 'SHIFT_ALREADY_OPEN');
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 2000 }], payments: [{ tender: 'cash', amount: 1000 }] });
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(2), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'card', amount: 250 }] });
    recordCashMovement(ctx, u.supervisor, 'out', 300, 'Bought ice');
    expect(shiftSummary(ctx, 1)).toMatchObject({ cashSales: 500, cardSales: 250, cashOut: 300, expectedCash: 10_200 });
    const closed = closeShift(ctx, u.cashier, 10_150);
    expect(closed).toMatchObject({ status: 'closed', countedCash: 10_150 });
    expect(balanceOf('6000')).toBe(50); // 0.50 short
    expect(() => ctx.db.prepare('UPDATE register_shifts SET counted_cash = 0').run()).toThrow(/immutable/);
  });

  it('cashier cannot move cash', () => {
    openShift(ctx, u.cashier, 0);
    expectDomain(() => recordCashMovement(ctx, u.cashier, 'in', 100, 'x'), 'PERMISSION_DENIED');
  });
});

describe('invariants under load', () => {
  it('300 random sales: books balance, stock matches movements, invoice numbers are unique and gapless', () => {
    openShift(ctx, u.cashier, 0);
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const price = { [water]: 250, [apples]: 799 } as Record<number, number>;
    let total = 0;
    let cashNet = 0;
    for (let i = 1; i <= 300; i++) {
      const lines = Array.from({ length: 1 + rand(5) }, () =>
        rand(2) ? { productId: water, qty: 1000 * (1 + rand(4)) } : { productId: apples, qty: 50 + rand(3000) },
      );
      const due = computeInvoice(lines.map((l) => ({ unitPriceIncl: price[l.productId]!, qty: l.qty, discount: 0, vatRate: 1500 }))).totalIncl;
      const byCard = rand(2) === 0;
      const r = finalizeSale(ctx, u.cashier, {
        idempotencyKey: key(i),
        lines,
        payments: byCard ? [{ tender: 'card', amount: due }] : [{ tender: 'cash', amount: due + rand(1000) }],
      });
      expect(r.totalIncl).toBe(due);
      total += due;
      if (!byCard) cashNet += due;
      if (i % 50 === 0) finalizeSale(ctx, u.cashier, { idempotencyKey: key(i), lines, payments: [{ tender: 'card', amount: due }] }); // retry noise
    }
    expect(unbalancedEntries(ctx)).toEqual([]);
    expect(stockDrift(ctx)).toEqual([]);
    expect(-balanceOf('4000') - balanceOf('2200')).toBe(total);
    expect(balanceOf('1010')).toBe(cashNet);
    expect(shiftSummary(ctx, 1).cashSales).toBe(cashNet);
    const nos = (ctx.db.prepare('SELECT invoice_no FROM sales ORDER BY id').all() as { invoice_no: string }[]).map((r) => r.invoice_no);
    expect(nos).toEqual(Array.from({ length: 300 }, (_, i) => `INV-${String(i + 1).padStart(8, '0')}`));
    const tb = trialBalance(ctx);
    expect(tb.reduce((s, r) => s + r.debit, 0)).toBe(tb.reduce((s, r) => s + r.credit, 0));
  });
});

describe('durability', () => {
  it('data survives closing and reopening; integrity check passes', () => {
    openShift(ctx, u.cashier, 0);
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(1), lines: [{ productId: water, qty: 1000 }], payments: [{ tender: 'cash', amount: 250 }] });
    ctx.db.close();
    const db2 = openDatabase(t.path);
    expect(db2.pragma('integrity_check', { simple: true })).toBe('ok');
    expect((db2.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(1);
    t.ctx.db = db2;
  });
});
