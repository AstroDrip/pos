import { BP_PER_WHOLE, assertSafeInt, extendPrice, roundDiv, type BasisPoints, type Halalas, type Milli } from './money';

// Shelf prices are VAT-inclusive (approved assumption, plan §C).
//
// Rounding rule (provisional until checked with the ZATCA SDK, plan §L-12):
//  1. Each line: gross = unitPriceIncl x qty, rounded half-up to a halala; minus line discount = lineIncl.
//  2. Per VAT rate: vat = round(sum(lineIncl) x rate / (1 + rate)); excl = incl - vat.
//  3. The rate's VAT is allocated back to lines by largest remainder,
//     so line VAT always sums exactly to the header VAT.

export interface LineInput {
  unitPriceIncl: Halalas;
  qty: Milli;
  discount: Halalas;
  vatRate: BasisPoints;
}

export interface LineResult {
  gross: Halalas;
  discount: Halalas;
  lineIncl: Halalas;
  lineVat: Halalas;
  lineExcl: Halalas;
  vatRate: BasisPoints;
}

export interface RateTotal {
  vatRate: BasisPoints;
  incl: Halalas;
  vat: Halalas;
  excl: Halalas;
}

export interface InvoiceTotals {
  lines: LineResult[];
  byRate: RateTotal[];
  totalIncl: Halalas;
  totalVat: Halalas;
  totalExcl: Halalas;
  totalDiscount: Halalas;
}

/** VAT contained in an inclusive amount, rounded half away from zero. */
export function vatFromInclusive(incl: Halalas, rate: BasisPoints): Halalas {
  assertSafeInt(incl, 'incl');
  assertSafeInt(rate, 'rate');
  if (rate < 0) throw new RangeError('rate must be >= 0');
  if (rate === 0) return 0;
  return roundDiv(incl * rate, BP_PER_WHOLE + rate);
}

export function computeInvoice(inputs: readonly LineInput[]): InvoiceTotals {
  const lines: LineResult[] = inputs.map((l) => {
    if (l.qty <= 0) throw new RangeError('qty must be positive');
    if (l.unitPriceIncl < 0) throw new RangeError('price must be >= 0');
    if (l.discount < 0) throw new RangeError('discount must be >= 0');
    const gross = extendPrice(l.unitPriceIncl, l.qty);
    if (l.discount > gross) throw new RangeError('discount exceeds line amount');
    return { gross, discount: l.discount, lineIncl: gross - l.discount, lineVat: 0, lineExcl: 0, vatRate: l.vatRate };
  });

  const rates = [...new Set(lines.map((l) => l.vatRate))].sort((a, b) => a - b);
  const byRate: RateTotal[] = [];

  for (const rate of rates) {
    const idx = lines.flatMap((l, i) => (l.vatRate === rate ? [i] : []));
    const incl = idx.reduce((s, i) => s + lines[i]!.lineIncl, 0);
    const vat = vatFromInclusive(incl, rate);
    allocate(vat, idx.map((i) => lines[i]!.lineIncl), rate).forEach((v, k) => {
      const line = lines[idx[k]!]!;
      line.lineVat = v;
      line.lineExcl = line.lineIncl - v;
    });
    byRate.push({ vatRate: rate, incl, vat, excl: incl - vat });
  }

  const totalIncl = byRate.reduce((s, r) => s + r.incl, 0);
  const totalVat = byRate.reduce((s, r) => s + r.vat, 0);
  return {
    lines,
    byRate,
    totalIncl,
    totalVat,
    totalExcl: totalIncl - totalVat,
    totalDiscount: lines.reduce((s, l) => s + l.discount, 0),
  };
}

/** Split `total` across lines in proportion to their exact VAT share (largest remainder). */
function allocate(total: Halalas, weights: readonly Halalas[], rate: BasisPoints): Halalas[] {
  if (rate === 0) return weights.map(() => 0);
  const denom = BP_PER_WHOLE + rate;
  const exact = weights.map((w) => w * rate);
  const floors = exact.map((e) => Math.floor(e / denom));
  let left = total - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - floors[i]! * denom }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = [...floors];
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]! += 1;
  return out;
}
