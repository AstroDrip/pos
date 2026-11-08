import { describe, expect, it } from 'vitest';
import { computeInvoice, vatFromInclusive, type LineInput } from './vat';

const STD = 1500;

describe('vatFromInclusive', () => {
  it('extracts 15% VAT from inclusive prices', () => {
    expect(vatFromInclusive(115, STD)).toBe(15); // 1.15 -> 0.15
    expect(vatFromInclusive(100, STD)).toBe(13); // 1.00 -> 0.1304 -> 0.13
    expect(vatFromInclusive(1000, 0)).toBe(0);
  });
});

describe('computeInvoice', () => {
  it('golden case: mixed weighed, piece, discount', () => {
    const t = computeInvoice([
      { unitPriceIncl: 799, qty: 1235, discount: 0, vatRate: STD }, // 9.87
      { unitPriceIncl: 250, qty: 3000, discount: 50, vatRate: STD }, // 7.50 - 0.50 = 7.00
    ]);
    expect(t.totalIncl).toBe(1687);
    expect(t.totalVat).toBe(220); // 16.87 * 15/115 = 2.2004 -> 2.20
    expect(t.totalExcl).toBe(1467);
    expect(t.totalDiscount).toBe(50);
    expect(t.lines.map((l) => l.lineIncl)).toEqual([987, 700]);
  });

  it('keeps zero-rated lines separate', () => {
    const t = computeInvoice([
      { unitPriceIncl: 1000, qty: 1000, discount: 0, vatRate: STD },
      { unitPriceIncl: 1000, qty: 1000, discount: 0, vatRate: 0 },
    ]);
    expect(t.byRate).toEqual([
      { vatRate: 0, incl: 1000, vat: 0, excl: 1000 },
      { vatRate: STD, incl: 1000, vat: 130, excl: 870 },
    ]);
  });

  it('rejects invalid lines', () => {
    expect(() => computeInvoice([{ unitPriceIncl: 100, qty: 0, discount: 0, vatRate: STD }])).toThrow();
    expect(() => computeInvoice([{ unitPriceIncl: 100, qty: 1000, discount: 101, vatRate: STD }])).toThrow();
    expect(() => computeInvoice([{ unitPriceIncl: -1, qty: 1000, discount: 0, vatRate: STD }])).toThrow();
  });

  it('property: line sums always equal header totals (5,000 random invoices)', () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      const lines: LineInput[] = Array.from({ length: 1 + rand(12) }, () => {
        const unitPriceIncl = rand(50_000);
        const qty = 1 + rand(5_000);
        const gross = Math.floor((unitPriceIncl * qty) / 1000);
        return { unitPriceIncl, qty, discount: rand(gross + 1), vatRate: rand(4) === 0 ? 0 : STD };
      });
      const t = computeInvoice(lines);
      expect(t.lines.reduce((s, l) => s + l.lineVat, 0)).toBe(t.totalVat);
      expect(t.lines.reduce((s, l) => s + l.lineExcl, 0)).toBe(t.totalExcl);
      expect(t.lines.reduce((s, l) => s + l.lineIncl, 0)).toBe(t.totalIncl);
      for (const l of t.lines) {
        expect(l.lineVat).toBeGreaterThanOrEqual(0);
        expect(l.lineExcl + l.lineVat).toBe(l.lineIncl);
      }
      for (const r of t.byRate) expect(r.vat).toBe(vatFromInclusive(r.incl, r.vatRate));
    }
  }, 30_000); // 5,000 invoices: timed out at 5 s when the PC was busy; the seed is fixed
});
