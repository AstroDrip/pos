// Chart points must equal what the reports already say. Every name is made up.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { profitAndLoss } from './financials';
import { receiveGoods } from './inventory';
import { createSupplier } from './parties';
import { salesSummary } from './reports';
import { finalizeSale } from './sales';
import { createPurchaseInvoice } from './purchasing';
import { financeSeries, purchaseSeries, salesList, salesSeries } from './series';
import { closeShift, openShift, openShiftId } from './shifts';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let item: number;
let k = 0;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const sell = (n = 1) => finalizeSale(ctx, u.cashier, { idempotencyKey: `series-${++k}-xxxx`, lines: [{ productId: item, qty: n * 1000 }], payments: [{ tender: 'cash', amount: n * 1_150 }] });
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};

// The test clock starts at 2026-11-05 08:00 UTC, which is 11:00 in Saudi Arabia.
beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  item = createProduct(ctx, u.admin, { sku: 'X', nameEn: 'Item', nameAr: 'صنف', unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: 1_150 });
  receiveGoods(ctx, u.admin, { supplierId: createSupplier(ctx, u.admin, { name: 'S' }), lines: [{ productId: item, qty: 500_000, unitCost: 600 }] });
  openShift(ctx, u.cashier, 0);
});
afterEach(() => t.cleanup());

describe('sales points', () => {
  it('days equal the report, and each carries count and average', () => {
    sell();
    sell(3);
    t.advance(DAY);
    sell(2);
    const pts = salesSeries(ctx, u.admin, { from: '2026-11-05', to: '2026-11-06', unit: 'day' });
    const report = salesSummary(ctx, u.admin, '2026-11-05', '2026-11-06');
    expect(pts.map((p) => p.sales)).toEqual(report.byDay.map((d) => d.totalIncl));
    expect(pts[0]).toMatchObject({ transactions: 2, sales: 4_600, average: 2_300 });
  });

  it('hours add up to the day, in Saudi time, with no invented hours', () => {
    sell(); // 11:00
    t.advance(2 * HOUR);
    sell(2); // 13:00
    const pts = salesSeries(ctx, u.admin, { from: '2026-11-05', to: '2026-11-05', unit: 'hour' });
    expect(pts.map((p) => p.hour)).toEqual([11, 12, 13]);
    expect(pts.map((p) => p.sales)).toEqual([1_150, 0, 2_300]);
    expect(pts.reduce((s, p) => s + p.sales!, 0)).toBe(salesSummary(ctx, u.admin, '2026-11-05', '2026-11-05').totalIncl);
  });

  it('a day with no sales at all gives no hours', () => {
    expect(salesSeries(ctx, u.admin, { from: '2026-11-05', to: '2026-11-05', unit: 'hour' })).toEqual([]);
  });

  it('days before the shop began are missing, and a quiet day after is a real zero', () => {
    t.advance(DAY);
    sell();
    const pts = salesSeries(ctx, u.admin, { from: '2026-11-04', to: '2026-11-06', unit: 'day' });
    expect(pts.map((p) => p.sales)).toEqual([null, 0, 1_150]);
    expect(pts[0]!.average).toBeNull();
    expect(pts[1]!.average).toBeNull();
  });

  it('weeks and months add up to the same total, and stay inside the chosen dates', () => {
    sell();
    t.advance(10 * DAY);
    openShiftIfNeeded();
    sell(2);
    const total = salesSummary(ctx, u.admin, '2026-11-01', '2026-11-30').totalIncl;
    for (const unit of ['week', 'month'] as const) {
      const pts = salesSeries(ctx, u.admin, { from: '2026-11-01', to: '2026-11-30', unit });
      expect(pts.reduce((s, p) => s + (p.sales ?? 0), 0)).toBe(total);
      expect(pts[0]!.from).toBe('2026-11-01');
      expect(pts.at(-1)!.to).toBe('2026-11-30');
    }
  });

  it('compares with a real earlier period, and says nothing if there was none', () => {
    sell();
    t.advance(7 * DAY);
    openShiftIfNeeded();
    sell(2);
    const [p] = salesSeries(ctx, u.admin, { from: '2026-11-12', to: '2026-11-12', unit: 'day' });
    expect(p).toMatchObject({ sales: 2_300, compare: 1_150 });
    const [q] = salesSeries(ctx, u.admin, { from: '2026-11-05', to: '2026-11-05', unit: 'day' });
    expect(q!.compare).toBeNull();
  });

  it('hours need a single day, and a cashier cannot read this', () => {
    expect(code(() => salesSeries(ctx, u.admin, { from: '2026-11-04', to: '2026-11-05', unit: 'hour' }))).toBe('VALIDATION');
    expect(code(() => salesSeries(ctx, u.cashier, { from: '2026-11-05', to: '2026-11-05', unit: 'day' }))).toBe('PERMISSION_DENIED');
  });
});

describe('the records behind a point', () => {
  it('lists the sales of the day or the hour, and their sum equals the point', () => {
    sell();
    t.advance(2 * HOUR);
    sell(2);
    const all = salesList(ctx, u.admin, { from: '2026-11-05', to: '2026-11-05' });
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0]).toMatchObject({ total: 2_300, payments: 'cash' });
    const hour = salesList(ctx, u.admin, { from: '2026-11-05', to: '2026-11-05', hour: 13 });
    expect(hour.rows.map((r) => r.total)).toEqual([2_300]);
  });

  it('needs report permission', () => {
    expect(code(() => salesList(ctx, u.cashier, { from: '2026-11-05', to: '2026-11-05' }))).toBe('PERMISSION_DENIED');
  });
});

describe('purchases over time', () => {
  it('equals the invoices entered, and days before the shop began are missing', () => {
    const sup = createSupplier(ctx, u.admin, { name: 'T' });
    const grn = receiveGoods(ctx, u.admin, { supplierId: sup, lines: [{ productId: item, qty: 1_000, unitCost: 1_000 }] }).grnId;
    createPurchaseInvoice(ctx, u.admin, { requestKey: 'series-pinv-0001', supplierId: sup, supplierInvoiceNo: 'A1', invoiceDate: '2026-11-05', dueDate: '2026-12-05', grnIds: [grn], invoiceNet: 1_000, vatAmount: 150, vatRecoverable: false });
    const pts = purchaseSeries(ctx, u.admin, { from: '2026-11-04', to: '2026-11-05' });
    expect(pts.map((p) => [p.gross, p.invoices])).toEqual([[null, null], [1_150, 1]]);
  });
});

describe('monthly result', () => {
  it('equals profit and loss for the month, and months before the shop are missing', () => {
    sell();
    const pts = financeSeries(ctx, u.admin, '2026-11-05', 3);
    expect(pts.map((p) => p.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(pts[0]!.netProfit).toBeNull();
    const pl = profitAndLoss(ctx, u.admin, '2026-11-01', '2026-11-05');
    expect(pts[2]).toMatchObject({ netSales: pl.netSales, grossProfit: pl.grossProfit, netProfit: pl.netProfit, expenses: pl.totalOperating });
  });
});

function openShiftIfNeeded() {
  const id = openShiftId(ctx);
  if (id !== null) closeShift(ctx, u.cashier, 0);
  openShift(ctx, u.cashier, 0);
}
