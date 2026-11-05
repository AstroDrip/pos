// Retail scenario tests from the audit prompt (RETAIL_SCENARIO_MATRIX.md references these by id, e.g. [S-3.2-04]).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extendPrice } from '../core/money';
import { ean13CheckDigit } from '../core/scale-barcode';
import { normalizeForSearch } from '../core/search-normalize';
import { createProduct, lookup, setAliases, setPrice, setProductActive } from './catalog';
import { DomainError, type Ctx } from './context';
import { holdBill, recallBill } from './held-bills';
import { receiveGoods, stockDrift } from './inventory';
import { trialBalance, unbalancedEntries } from './ledger';
import { createSupplier } from './parties';
import { cashierActivity } from './reports';
import { finalizeSale } from './sales';
import { searchProducts } from './search';
import { closeShift, openShift, recordCashMovement, shiftSummary } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';
import { authenticate, setUserActive } from './users';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const ids: Record<string, number> = {};
const ean = (s: string) => s + ean13CheckDigit(s);

const P = (key: string, nameEn: string, nameAr: string, price: number, opts: { kg?: boolean; barcode?: string; plu?: string; aliases?: string[]; vat?: number } = {}) =>
  (ids[key] = createProduct(ctx, u.admin, {
    sku: key, nameEn, nameAr, unitCode: opts.kg ? 'KG' : 'PCS', sellMode: opts.kg ? 'weight' : 'unit',
    vatRateBp: opts.vat ?? 1500, priceIncl: price, barcodes: opts.barcode ? [opts.barcode] : [], plu: opts.plu, aliases: opts.aliases,
  }));

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  P('BAN', 'Banana', 'موز', 599, { kg: true, plu: '125' });
  P('BANP', 'Banana Premium', 'موز ممتاز', 899, { kg: true, plu: '126' });
  P('BANI', 'Banana Imported', 'موز مستورد', 799, { kg: true, plu: '127' });
  P('BANB', 'Banana Bunch', 'قرط موز', 1200, { barcode: ean('628100000010') });
  P('RICE5', 'Basmati Rice 5kg', 'أرز بسمتي ٥ كجم', 3200, { barcode: ean('628100000011'), aliases: ['Biryani rice'] });
  P('RICE1', 'Basmati Rice 1kg', 'أرز بسمتي ١ كجم', 750, { barcode: ean('628100000012') });
  P('MILK', 'Fresh Milk 1L', 'حليب طازج', 650, { barcode: ean('628100000013') });
  P('LAMB', 'Lamb Leg', 'فخذ غنم', 4999, { kg: true, plu: '200' });
  P('BREAD', 'Arabic Bread', 'خبز عربي', 100, { vat: 0, barcode: ean('628100000014') }); // VAT treatment for test only
  ctx.db.prepare("INSERT INTO scale_barcode_formats (prefix, item_digits, value_digits, embedded) VALUES ('21', 5, 5, 'weight'), ('22', 5, 5, 'price')").run();
  const sup = createSupplier(ctx, u.admin, { name: 'Supplier' });
  receiveGoods(ctx, u.admin, { supplierId: sup, lines: Object.values(ids).map((id) => ({ productId: id, qty: 100_000, unitCost: 100 })) });
});
afterEach(() => t.cleanup());

const errCode = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW: ${(e as Error).message}`;
  }
};
const names = (q: string) => searchProducts(ctx, q).map((h) => h.product.nameEn);
let k = 0;
const key = () => `scenario-key-${++k}`;

describe('Part 2 — indexed search', () => {
  it('[S-2-01] three letters "ban" lists every banana, shortest names first', () => {
    expect(names('ban')).toEqual(['Banana', 'Banana Bunch', 'Banana Premium', 'Banana Imported']);
  });
  it('[S-2-02] Arabic search ignores harakat, alef forms and digit style', () => {
    expect(names('موز')).toContain('Banana');
    expect(names('مُوز')).toContain('Banana');
    expect(names('ارز')).toEqual(['Basmati Rice 1kg', 'Basmati Rice 5kg']); // stored as أرز
    expect(names('ارز بسمتي 5')).toEqual(['Basmati Rice 5kg']);
    expect(normalizeForSearch('أرز بسمتي ٥ كجم')).toBe('ارز بسمتي 5 كجم');
  });
  it('[S-2-03] ranking: exact barcode > exact SKU/PLU > exact name > starts-with > word prefix > alias', () => {
    const h = searchProducts(ctx, 'banana');
    expect(h[0]).toMatchObject({ matchedBy: 'name', product: { nameEn: 'Banana' } });
    expect(searchProducts(ctx, ean('628100000010'))[0]).toMatchObject({ rank: 1, matchedBy: 'barcode', product: { sku: 'BANB' } });
    expect(searchProducts(ctx, '125')[0]).toMatchObject({ rank: 2, matchedBy: 'plu', product: { sku: 'BAN' } });
    expect(searchProducts(ctx, 'premium')[0]).toMatchObject({ matchedBy: 'word_prefix', product: { sku: 'BANP' } });
    expect(searchProducts(ctx, 'biryani')[0]).toMatchObject({ matchedBy: 'alias', product: { sku: 'RICE5' } });
  });
  it('[S-2-04] partial SKU, similar names stay distinct, search text cannot inject FTS syntax', () => {
    expect(names('RIC')).toEqual(expect.arrayContaining(['Basmati Rice 1kg', 'Basmati Rice 5kg']));
    expect(names('rice 1')).toEqual(['Basmati Rice 1kg']);
    for (const evil of ['"', '*', 'ban AND', 'ban OR milk', 'NEAR(', "'; DROP TABLE products; --", 'names:ban']) {
      expect(() => searchProducts(ctx, evil)).not.toThrow();
    }
    expect((ctx.db.prepare('SELECT count(*) AS n FROM products').get() as { n: number }).n).toBe(9);
  });
  it('[S-2-05] inactive products disappear from search; scanning them says "inactive" instead of adding anything', () => {
    setProductActive(ctx, u.admin, ids.MILK!, false, 'Discontinued');
    expect(names('milk')).toEqual([]);
    expect(errCode(() => lookup(ctx, ean('628100000013')))).toBe('VALIDATION');
    setProductActive(ctx, u.admin, ids.MILK!, true, 'Back in range');
    expect(names('milk')).toEqual(['Fresh Milk 1L']);
  });
  it('[S-2-06] aliases are owner-approved and audited', () => {
    setAliases(ctx, u.admin, ids.LAMB!, ['Mutton', 'لحم']);
    expect(names('mutt')).toEqual(['Lamb Leg']);
    expect(errCode(() => setAliases(ctx, u.cashier, ids.LAMB!, ['x']))).toBe('PERMISSION_DENIED');
  });
});

describe('Part 3.3 — weighed-product labels', () => {
  it('[S-3.3-01] weight label: product and weight read; price = weight x current price per kg', () => {
    expect(lookup(ctx, ean('210012501235'))).toMatchObject({ product: { sku: 'BAN' }, qty: 1235, source: 'scale' });
  });
  it('[S-3.3-02] price label: the printed price is charged exactly; the weight is derived from it', () => {
    expect(lookup(ctx, ean('220012500599'))).toMatchObject({ qty: 1000 });
    setPrice(ctx, u.admin, ids.BAN!, 650);
    // FINDING F-SCALE-1: at a few SAR/kg every halala amount maps to some whole-gram weight, so a price-only label
    // printed at the OLD price cannot be detected. The POS still charges exactly the printed 5.99.
    const r = lookup(ctx, ean('220012500599'))!;
    expect(extendPrice(650, r.qty)).toBe(599);
    // For dear items (more than 1 halala per gram) an out-of-date price label IS detected and refused.
    setPrice(ctx, u.admin, ids.LAMB!, 5299);
    expect(errCode(() => lookup(ctx, ean('220020004999')))).toBe('VALIDATION');
  });
  it('[S-3.3-03] zero weight, impossible weight/price, damaged check digit, unknown code, non-weighed PLU: all rejected', () => {
    expect(errCode(() => lookup(ctx, ean('210012500000')))).toBe('VALIDATION'); // zero weight
    expect(errCode(() => lookup(ctx, ean('210012599999')))).toBe('VALIDATION'); // 99.999 kg > 30 kg limit
    expect(errCode(() => lookup(ctx, ean('220012599999')))).toBe('VALIDATION'); // 999.99 SAR > limit
    const good = ean('210012501235');
    expect(errCode(() => lookup(ctx, good.slice(0, 12) + ((Number(good[12]) + 1) % 10)))).toBe('VALIDATION'); // damaged
    expect(errCode(() => lookup(ctx, ean('210099901000')))).toBe('NOT_FOUND'); // product code not set up
    ctx.db.prepare("INSERT INTO plu_codes (plu, product_id) VALUES ('300', ?)").run(ids.MILK);
    expect(errCode(() => lookup(ctx, ean('210030001000')))).toBe('VALIDATION'); // a piece product on a scale label
  });
  it('[S-3.3-04] two packages with the same product but different weights become two lines priced separately', () => {
    openShift(ctx, u.cashier, 0);
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.LAMB!, qty: 1235 }, { productId: ids.LAMB!, qty: 870 }], payments: [{ tender: 'card', amount: 6174 + 4349 }] });
    expect(r.totalIncl).toBe(6174 + 4349); // 1.235 x 49.99 = 61.74 ; 0.870 x 49.99 = 43.49
  });
});

describe('Part 3.1 / 3.5 — checkout and payments', () => {
  beforeEach(() => void openShift(ctx, u.cashier, 10_000));

  it('[S-3.1-01] 50 different lines: lines, VAT and totals reconcile', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ productId: Object.values(ids)[i % 9]!, qty: Object.keys(ids)[i % 9]!.match(/BAN$|BANP|BANI|LAMB/) ? 100 + i * 7 : 1000 * (1 + (i % 3)) }));
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: many, payments: [{ tender: 'cash', amount: 10_000_000 }] });
    const lines = ctx.db.prepare('SELECT SUM(line_incl) AS i, SUM(line_vat) AS v FROM sale_lines WHERE sale_id = ?').get(r.saleId) as { i: number; v: number };
    expect(lines.i).toBe(r.totalIncl);
    expect(lines.v).toBe(r.totalVat);
    expect(unbalancedEntries(ctx)).toEqual([]);
  });

  it('[S-3.1-02] mixed VAT treatments are totalled per rate', () => {
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }, { productId: ids.BREAD!, qty: 5000 }], payments: [{ tender: 'card', amount: 1150 }] });
    expect(r).toMatchObject({ totalIncl: 1150, totalVat: 85 }); // VAT only on milk: 6.50 x 15/115 = 0.85
  });

  it('[S-3.1-03 / Scenario M] price changed while in the basket: refused, never charged silently', () => {
    setPrice(ctx, u.admin, ids.MILK!, 700);
    expect(errCode(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000, expectedUnitPrice: 650 }], payments: [{ tender: 'card', amount: 650 }] }))).toBe('PRICE_CHANGED');
    expect((ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n).toBe(0);
    expect(finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000, expectedUnitPrice: 700 }], payments: [{ tender: 'card', amount: 700 }] }).totalIncl).toBe(700);
  });

  it('[S-3.5-01] split cash + card with change from cash only', () => {
    const r = finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.RICE5!, qty: 1000 }], payments: [{ tender: 'card', amount: 2000 }, { tender: 'cash', amount: 1500 }] });
    expect(r.changeGiven).toBe(300);
    expect(shiftSummary(ctx, 1)).toMatchObject({ cashSales: 1200, cardSales: 2000 });
  });

  it('[S-3.5-02 / Scenario K] pay pressed 5 times with the same bill: one sale, one payment, one stock movement', () => {
    const input = { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }], payments: [{ tender: 'cash' as const, amount: 1000 }] };
    const results = Array.from({ length: 5 }, () => finalizeSale(ctx, u.cashier, input));
    expect(new Set(results.map((r) => r.saleId)).size).toBe(1);
    expect((ctx.db.prepare('SELECT count(*) AS n FROM payments').get() as { n: number }).n).toBe(1);
  });

  it('[S-3.1-04] recalled held bill paid twice is still one sale (bill key travels with the hold)', () => {
    const billKey = key();
    const h = holdBill(ctx, u.cashier, 'x', { lines: [{ productId: ids.MILK!, qty: 1000 }], billKey });
    const back = recallBill(ctx, u.cashier, h);
    const a = finalizeSale(ctx, u.cashier, { idempotencyKey: back.billKey!, lines: back.lines, payments: [{ tender: 'card', amount: 650 }] });
    const b = finalizeSale(ctx, u.cashier, { idempotencyKey: back.billKey!, lines: back.lines, payments: [{ tender: 'card', amount: 650 }] });
    expect(b).toMatchObject({ saleId: a.saleId, replayed: true });
  });

  it('[S-12-01] clock set backwards: selling is refused until the clock is fixed', () => {
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }], payments: [{ tender: 'card', amount: 650 }] });
    t.advance(-60 * 60_000);
    expect(errCode(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }], payments: [{ tender: 'card', amount: 650 }] }))).toBe('CLOCK_WRONG');
    t.advance(-5 * 60_000 + 60 * 60_000); // within tolerance
    expect(errCode(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }], payments: [{ tender: 'card', amount: 650 }] }))).toBe('OK');
  });
});

describe('Part 5 / 13 — users and abuse', () => {
  it('[S-13-01] a deactivated user cannot log in or approve a discount; the last admin cannot be removed', () => {
    setUserActive(ctx, u.admin, u.supervisor, false);
    expect(errCode(() => authenticate(ctx, 'sup', '2222'))).toBe('AUTH_FAILED');
    openShift(ctx, u.cashier, 0);
    expect(errCode(() => finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000, discount: 50 }], payments: [{ tender: 'card', amount: 600 }], discountApproverId: u.supervisor }))).toBe('PERMISSION_DENIED');
    expect(errCode(() => setUserActive(ctx, u.admin, u.admin, false))).toBe('VALIDATION');
    expect(errCode(() => setUserActive(ctx, u.cashier, u.admin, false))).toBe('PERMISSION_DENIED');
  });
});

describe('Part 6 / 7 — stock', () => {
  it('[S-7-01] "Save receipt" pressed twice with the same request key receives the goods once', () => {
    const sup = createSupplier(ctx, u.admin, { name: 'S2' });
    const req = { requestKey: key(), supplierId: sup, lines: [{ productId: ids.MILK!, qty: 12_000, unitCost: 480 }] };
    const a = receiveGoods(ctx, u.admin, req);
    const b = receiveGoods(ctx, u.admin, req);
    expect(b).toEqual(a);
    expect((ctx.db.prepare("SELECT count(*) AS n FROM stock_movements WHERE source_type = 'grn' AND product_id = ?").get(ids.MILK) as { n: number }).n).toBe(2); // opening GRN + this one
    expect(stockDrift(ctx)).toEqual([]);
  });
});

describe('Part 8 / 14 — cash reconciliation and owner visibility', () => {
  it('[Scenario I] SAR 50 shortage is visible with its expected-cash breakdown and attributed to the closing cashier', () => {
    openShift(ctx, u.cashier, 50_000);
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.RICE5!, qty: 2000 }], payments: [{ tender: 'cash', amount: 7000 }] });
    finalizeSale(ctx, u.cashier, { idempotencyKey: key(), lines: [{ productId: ids.MILK!, qty: 1000 }], payments: [{ tender: 'card', amount: 650 }] });
    recordCashMovement(ctx, u.supervisor, 'out', 2000, 'Cleaning supplies');
    const s = shiftSummary(ctx, 1);
    expect(s).toMatchObject({ openingFloat: 50_000, cashSales: 6400, cardSales: 650, cashOut: 2000, expectedCash: 54_400 });
    closeShift(ctx, u.cashier, 49_400);
    const act = cashierActivity(ctx, u.admin, '2026-11-05', '2026-11-05');
    expect(act.find((a) => a.user === 'Cashier')).toMatchObject({ sales: 2, cashNet: 6400, card: 650, shiftsClosed: 1, overShortTotal: -5000 });
    expect(act.find((a) => a.user === 'Supervisor')).toMatchObject({ cashOutCount: 1, cashOutTotal: 2000 });
    const tb = trialBalance(ctx).find((r) => r.code === '6000')!;
    expect(tb.debit - tb.credit).toBe(5000);
  });
});
