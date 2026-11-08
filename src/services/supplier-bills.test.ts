// Numbers come from real supplier papers; every name here is made up.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProduct } from './catalog';
import { DomainError, type Ctx } from './context';
import { datedTrialBalance } from './financials';
import { dryRunSuppliers, importSuppliers } from './import';
import { stockDrift } from './inventory';
import { unbalancedEntries } from './ledger';
import { createSupplier, listSuppliers, updateSupplier } from './parties';
import { supplierBalances, uninvoicedGrns } from './purchasing';
import { openShift } from './shifts';
import { createSupplierBill, findSupplierItem, type SupplierBillInput } from './supplier-bills';
import { makeTestCtx, seedUsers } from './test-helpers';
import { vatSummary } from './vat-report';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
let apple: number;
let grape: number;
let cheese: number;
let sup: number;
let n = 0;
const key = () => `bill-key-${++n}-xxxx`;
const TODAY = '2026-11-05';
const VATNO = '300000000000003';

const acct = (code: string) => {
  const r = datedTrialBalance(ctx, u.admin, '2000-01-01', '2099-12-31').rows.find((x) => x.code === code);
  return r ? r.debit - r.credit : 0;
};
const owed = () => supplierBalances(ctx, u.admin).find((r) => r.supplierId === sup)?.balance ?? 0;
const count = (table: string) => (ctx.db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
const stock = (id: number) => ctx.db.prepare('SELECT qty, avg_cost AS avg FROM stock_balances WHERE product_id = ?').get(id) as { qty: number; avg: number };
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROW ${(e as Error).message}`;
  }
};
const books = () => {
  expect(unbalancedEntries(ctx)).toEqual([]);
  expect(stockDrift(ctx)).toEqual([]);
  expect(supplierBalances(ctx, u.admin).reduce((s, r) => s + r.balance, 0)).toBe(0 - acct('2000'));
  expect(uninvoicedGrns(ctx, u.admin).reduce((s, g) => s + g.totalCost, 0)).toBe(0 - acct('2100'));
};
type Line = SupplierBillInput['lines'][number];
const line = (o: Partial<Line>): Line => ({ productId: apple, packName: 'CTN', pageNo: 1, unitsPerPack: 24_000, packs: 0, looseQty: 0, freeQty: 0, priceBasis: 'pack', price: 0, vatRateBp: 1500, ...o });
const juice = (o: Partial<SupplierBillInput> = {}): SupplierBillInput => ({
  requestKey: key(), supplierId: sup, docType: 'tax_invoice', docNo: 'IR-1', docDate: TODAY, payType: 'credit', pages: 1, billDiscount: 0, billCharge: 0,
  paper: { net: 34_101, vat: 5_115, total: 39_216 },
  lines: [line({ supplierCode: '98001', packs: 2, price: 11_136 }), line({ productId: grape, supplierCode: '98002', packs: 1, price: 11_829 })],
  ...o,
});
const save = (o: Partial<SupplierBillInput> = {}) => createSupplierBill(ctx, u.admin, juice(o));

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  const p = (sku: string, sellMode: 'unit' | 'weight' = 'unit') => createProduct(ctx, u.admin, { sku, nameEn: `Item ${sku}`, nameAr: 'صنف', unitCode: sellMode === 'unit' ? 'PCS' : 'KG', sellMode, vatRateBp: 1500, priceIncl: 900 });
  apple = p('APPLE');
  grape = p('GRAPE');
  cheese = p('CHEESE', 'weight');
  sup = createSupplier(ctx, u.admin, { name: 'Made Up Drinks', vatNumber: VATNO, paymentTermsDays: 30 });
});
afterEach(() => t.cleanup());

describe('saving a supplier bill', () => {
  it('tax invoice on credit: stock, 2100 cleared, owed 392.16, stock value exactly 341.01, 5010 is 0', () => {
    const r = save();
    expect(r.pinvNo).toBe('PI-000001');
    expect(r.grnNo).toBe('GRN-000001');
    expect(acct('1200')).toBe(34_101);
    expect(acct('2100')).toBe(0);
    expect(acct('2210')).toBe(5_115);
    expect(acct('5010')).toBe(0);
    expect(owed()).toBe(39_216);
    expect(stock(apple).qty).toBe(48_000);
    expect(stock(grape).qty).toBe(24_000);
    books();
  });

  it('keeps every line as printed', () => {
    const r = save();
    const rows = ctx.db.prepare('SELECT * FROM supplier_bill_lines WHERE bill_id = ? ORDER BY line_no').all(r.billId) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ supplier_code: '98002', pack_name: 'CTN', units_per_pack: 24_000, packs: 1, price: 11_829, net: 11_829, vat: 1_774, total: 13_603, grn_line_from: 2, grn_line_count: 2 });
  });

  it('paid bill: payment for the full total, nothing owed', () => {
    openShift(ctx, u.admin, 0);
    save({ payType: 'paid', payMethod: 'till' });
    expect(owed()).toBe(0);
    expect(acct('1010')).toBe(-39_216);
    books();
  });

  it('paid bill can come from the bank', () => {
    save({ payType: 'paid', payMethod: 'bank' });
    expect(owed()).toBe(0);
    expect(acct('1030')).toBe(-39_216);
  });

  it('part paid on credit leaves the rest owed', () => {
    save({ paidNow: 10_000, payMethod: 'bank' });
    expect(owed()).toBe(29_216);
    books();
  });

  it('delivery note: stock in, 2100 up, nothing owed, VAT not posted', () => {
    const r = save({ docType: 'delivery_note' });
    expect(r.pinvNo).toBeNull();
    expect(stock(apple).qty).toBe(48_000);
    expect(acct('2100')).toBe(-34_101);
    expect(acct('2210')).toBe(0);
    expect(owed()).toBe(0);
    books();
  });

  it('proforma: VAT in 5010, not 2210, unless claimVat', () => {
    save({ docType: 'proforma' });
    expect(acct('5010')).toBe(5_115);
    expect(acct('2210')).toBe(0);
    save({ docType: 'proforma', docNo: 'P-2', claimVat: true });
    expect(acct('2210')).toBe(5_115);
    books();
  });

  it('a bill with no VAT saves without a VAT claim', () => {
    expect(code(() => save({ paper: { net: 34_101, vat: 0, total: 34_101 }, lines: juice().lines.map((l) => ({ ...l, vatRateBp: 0 })) }))).toBe('OK');
    expect(acct('2210')).toBe(0);
  });

  it('VAT summary reconciles after each paper type', () => {
    save();
    save({ docType: 'proforma', docNo: 'P-1' });
    save({ docType: 'delivery_note', docNo: 'D-1' });
    save({ docType: 'other', docNo: 'O-1' });
    expect(vatSummary(ctx, u.admin, TODAY, TODAY).reconciles).toBe(true);
  });

  it('totals not matching the paper are refused', () => {
    expect(code(() => save({ paper: { net: 34_102, vat: 5_115, total: 39_217 } }))).toBe('VALIDATION');
    expect(code(() => save({ paper: { net: 34_101, vat: 5_114, total: 39_215 } }))).toBe('VALIDATION');
    expect(code(() => save({ paper: { net: 34_101, vat: 5_115, total: 39_216, gross: 1 } }))).toBe('VALIDATION');
    expect(count('supplier_bills')).toBe(0);
    expect(count('goods_receipts')).toBe(0);
  });

  it('same paper twice is refused and names the first', () => {
    save();
    expect(() => save()).toThrow(/IR-1/);
    expect(count('supplier_bills')).toBe(1);
  });

  it('double save returns the first bill', () => {
    const input = juice();
    const a = createSupplierBill(ctx, u.admin, input);
    const b = createSupplierBill(ctx, u.admin, input);
    expect(b).toMatchObject({ billId: a.billId, grnNo: a.grnNo, pinvNo: a.pinvNo, replayed: true });
    expect(stock(apple).qty).toBe(48_000);
  });

  it('paid from till with no shift keeps nothing', () => {
    expect(code(() => save({ payType: 'paid', payMethod: 'till' }))).not.toBe('OK');
    for (const table of ['supplier_bills', 'supplier_bill_lines', 'goods_receipts', 'stock_movements', 'purchase_invoices', 'supplier_items']) expect(count(table), table).toBe(0);
    books();
  });

  it('remembers code, pack and price for next time', () => {
    save();
    expect(findSupplierItem(ctx, sup, '98001')).toMatchObject({ productId: apple, packName: 'CTN', unitsPerPack: 24_000, lastPrice: 11_136 });
    expect(findSupplierItem(ctx, sup, 'NOPE')).toBeNull();
    save({ docNo: 'IR-2', paper: { net: 34_301, vat: 5_145, total: 39_446 }, lines: [line({ supplierCode: '98001', packs: 2, price: 11_236 }), line({ productId: grape, supplierCode: '98002', packs: 1, price: 11_829 })] });
    expect(findSupplierItem(ctx, sup, '98001')!.lastPrice).toBe(11_236);
  });

  it('a supplier code on a second product is refused', () => {
    save();
    expect(() => save({ docNo: 'IR-2', lines: [line({ productId: grape, supplierCode: '98001', packs: 2, price: 11_136 }), line({ productId: apple, supplierCode: '98003', packs: 1, price: 11_829 })] })).toThrow(/Item APPLE/);
    expect(count('supplier_bills')).toBe(1);
  });

  it('short delivery uses reason and posts the gap to 5010', () => {
    const lines = juice().lines.map((l, i) => (i === 0 ? { ...l, receivedQty: 47_000 } : l));
    expect(code(() => save({ lines }))).toBe('VALIDATION');
    save({ lines, differenceReason: 'Short delivery' });
    expect(stock(apple).qty).toBe(47_000);
    expect(acct('5010')).toBe(464);
    expect(owed()).toBe(39_216);
    books();
  });

  it('free goods lower average cost', () => {
    save({ paper: { net: 1_200, vat: 180, total: 1_380 }, lines: [line({ unitsPerPack: 1_000, packs: 10, freeQty: 2_000, price: 120 })] });
    expect(stock(apple)).toEqual({ qty: 12_000, avg: 100 });
    expect(acct('1200')).toBe(1_200);
  });

  it('a kg line needs no typed reason', () => {
    expect(code(() => save({ paper: { net: 777, vat: 117, total: 894 }, lines: [line({ productId: cheese, unitsPerPack: 1_000, looseQty: 1_234, priceBasis: 'unit', price: 630 })] }))).toBe('OK');
    expect(Math.abs(acct('1200') - 777)).toBeLessThanOrEqual(1);
    books();
  });

  it('refuses bad input before anything is saved', () => {
    expect(code(() => save({ docNo: ' ' }))).toBe('VALIDATION');
    expect(code(() => save({ docDate: '2099-01-01' }))).toBe('VALIDATION');
    expect(code(() => save({ lines: [] }))).toBe('VALIDATION');
    expect(code(() => save({ lines: [line({ unitsPerPack: 0, packs: 1, price: 10 })] }))).toBe('VALIDATION');
    expect(count('supplier_bills')).toBe(0);
  });

  it('needs the right permission', () => {
    expect(code(() => createSupplierBill(ctx, u.cashier, juice()))).toBe('PERMISSION_DENIED');
  });
});

describe('supplier card', () => {
  const fields = { name: 'New Name', phone: '0500000000', vatNumber: VATNO, paymentTermsDays: 7, address: 'Made Up Road', crNumber: '1234567890', ourCustomerNo: 'C-77', salesman: 'Made Up Agent' };

  it('updateSupplier saves all fields, needs supplier.manage, is audited', () => {
    updateSupplier(ctx, u.admin, sup, fields);
    expect(listSuppliers(ctx).find((s) => s.id === sup)).toMatchObject(fields);
    expect(code(() => updateSupplier(ctx, u.cashier, sup, fields))).toBe('PERMISSION_DENIED');
    expect(count("audit_log WHERE action = 'supplier.update'")).toBe(1);
  });

  it('refuses a bad VAT number and an unknown supplier', () => {
    expect(code(() => updateSupplier(ctx, u.admin, sup, { ...fields, vatNumber: '12' }))).toBe('VALIDATION');
    expect(code(() => updateSupplier(ctx, u.admin, 999, fields))).toBe('NOT_FOUND');
  });

  it('CSV import takes the new optional columns', () => {
    const csv = 'name,address,cr_number,our_customer_no,salesman\nCsv Supplier,Csv Road,999,C-1,Csv Agent\n';
    expect(dryRunSuppliers(ctx, csv).issues).toEqual([]);
    importSuppliers(ctx, u.admin, csv);
    expect(listSuppliers(ctx).find((s) => s.name === 'Csv Supplier')).toMatchObject({ address: 'Csv Road', crNumber: '999', ourCustomerNo: 'C-1', salesman: 'Csv Agent' });
  });
});
