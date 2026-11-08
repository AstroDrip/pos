import { describe, expect, it } from 'vitest';
import { roundDiv } from './money';
import { computeBill, splitCost, type BillLineInput } from './supplier-bill';

const STD = 1500;
const line = (o: Partial<BillLineInput>): BillLineInput => ({ unitsPerPack: 24_000, packs: 0, looseQty: 0, freeQty: 0, priceBasis: 'pack', price: 0, vatRateBp: STD, ...o });
const totals = (b: ReturnType<typeof computeBill>) => [b.gross, b.discount, b.net, b.vat, b.total];

describe('computeBill', () => {
  it('snack page: 532.86 / 32.48 / 500.38 / 75.07 / 575.45', () => {
    const rows: [number, number, number][] = [[1455, 3, 131], [6020, 1, 181], [4380, 1, 790], [2346, 2, 141], [938, 4, 113], [7440, 2, 1436], [6192, 1, 186], [922, 5, 138], [879, 5, 132]];
    const b = computeBill(rows.map(([price, packs, discountAmount]) => line({ price, packs, discountAmount })), 0, 0);
    expect(totals(b)).toEqual([53_286, 3_248, 50_038, 7_507, 57_545]);
    expect(b.lines[2]).toMatchObject({ net: 3_590, vat: 539, total: 4_129 });
  });

  it('juice bill: 341.01 / 51.15 / 392.16', () => {
    const b = computeBill([line({ packs: 2, price: 11_136 }), line({ packs: 1, price: 11_829 })], 0, 0);
    expect(totals(b)).toEqual([34_101, 0, 34_101, 5_115, 39_216]);
    expect(b.lines[0]).toMatchObject({ billedQty: 48_000, vat: 3_341 });
    expect(b.lines[1]).toMatchObject({ billedQty: 24_000, vat: 1_774 });
  });

  it('dairy loose pieces: 0 cases + 5 at 82.60 per 20 = 20.65', () => {
    const b = computeBill([line({ unitsPerPack: 20_000, looseQty: 5_000, price: 8_260 })], 0, 0);
    expect(b.lines[0]).toMatchObject({ billedQty: 5_000, gross: 2_065, vat: 310, total: 2_375 });
  });

  it('price per piece', () => {
    expect(computeBill([line({ priceBasis: 'unit', looseQty: 5_000, price: 413 })], 0, 0).lines[0]!.gross).toBe(2_065);
  });

  it('a percent discount rounds on the line', () => {
    expect(computeBill([line({ packs: 3, price: 1_455, discountBp: 300 })], 0, 0).lines[0]!.discount).toBe(131);
  });

  it('VAT rounds half up per line and can be overtyped', () => {
    expect(computeBill([line({ packs: 1, price: 990 })], 0, 0).lines[0]!.vat).toBe(149); // 148.5
    expect(computeBill([line({ packs: 1, price: 990, vatOverride: 148 })], 0, 0).lines[0]).toMatchObject({ vat: 148, total: 1_138 });
    expect(computeBill([line({ packs: 1, price: 990, vatRateBp: 0 })], 0, 0).lines[0]!.vat).toBe(0);
  });

  it('bill discount and charge spread by value, largest remainder, sums exact', () => {
    const b = computeBill([line({ packs: 1, price: 1_000 }), line({ packs: 1, price: 1_000 }), line({ packs: 1, price: 1_000 })], 100, 0);
    expect(b.lines.map((l) => l.net).sort()).toEqual([966, 967, 967]);
    expect(b.net).toBe(2_900);
    expect(b.discount).toBe(100);
    const c = computeBill([line({ packs: 1, price: 3_000 }), line({ packs: 1, price: 1_000 })], 0, 400);
    expect(c.lines.map((l) => l.net)).toEqual([3_300, 1_100]);
  });

  it('free goods lower the cost', () => {
    const b = computeBill([line({ unitsPerPack: 1_000, packs: 10, freeQty: 2_000, price: 120 })], 0, 0);
    expect(b.lines[0]).toMatchObject({ net: 1_200, costQty: 12_000, stockQty: 12_000, stockValue: 1_200 });
  });

  it('short delivery', () => {
    const b = computeBill([line({ unitsPerPack: 1_000, packs: 10, price: 100, receivedQty: 9_000 })], 0, 0);
    expect(b.lines[0]).toMatchObject({ net: 1_000, stockQty: 9_000, stockValue: 900 });
  });

  it('refuses pack size 0 and discount above gross', () => {
    expect(() => computeBill([line({ unitsPerPack: 0, packs: 1, price: 100 })], 0, 0)).toThrow(RangeError);
    expect(() => computeBill([line({ packs: 1, price: 100, discountAmount: 101 })], 0, 0)).toThrow(RangeError);
  });

  it('refuses a line with no quantity, more received than billed, or a bill discount above the goods', () => {
    expect(() => computeBill([line({ price: 100 })], 0, 0)).toThrow(RangeError);
    expect(() => computeBill([line({ unitsPerPack: 1_000, packs: 1, price: 100, receivedQty: 2_000 })], 0, 0)).toThrow(RangeError);
    expect(() => computeBill([line({ packs: 1, price: 100 })], 101, 0)).toThrow(RangeError);
  });
});

describe('splitCost', () => {
  it('118.29 over 24 = 21 at 493 + 3 at 492', () => {
    expect(splitCost(11_829, 24_000)).toEqual([{ qty: 21_000, unitCost: 493 }, { qty: 3_000, unitCost: 492 }]);
  });

  it('exact division gives one row', () => {
    expect(splitCost(22_272, 48_000)).toEqual([{ qty: 48_000, unitCost: 464 }]);
  });

  it('value 0 gives cost 0', () => {
    expect(splitCost(0, 5_000)).toEqual([{ qty: 5_000, unitCost: 0 }]);
  });

  it('nothing received gives no rows', () => {
    expect(splitCost(0, 0)).toEqual([]);
  });

  it('kg 1.234 for 7.77 stays within 1 halala', () => {
    const rows = splitCost(777, 1_234);
    expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(1_234);
    const value = rows.reduce((s, r) => s + roundDiv(r.qty * r.unitCost, 1000), 0);
    expect(Math.abs(value - 777)).toBeLessThanOrEqual(1);
  });

  it('whole pieces always land exactly', () => {
    for (let value = 1; value < 5_000; value += 37) {
      for (const qty of [1_000, 7_000, 24_000, 144_000]) {
        const rows = splitCost(value, qty);
        expect(rows.every((r) => r.qty % 1_000 === 0)).toBe(true);
        expect(rows.reduce((s, r) => s + (r.qty * r.unitCost) / 1000, 0)).toBe(value);
      }
    }
  });
});
