import { MILLI_PER_UNIT, roundDiv } from './money';

// Supplier bill arithmetic. Money in halalas, quantities in milli-units. Pure; unit-tested.
//
// A pack is only a name and how many pieces are inside, so any supplier's pack codes work.

export interface BillLineInput {
  /** Pieces in one pack, in milli-units (24 pieces = 24000). */
  unitsPerPack: number;
  packs: number;
  looseQty: number;
  freeQty: number;
  /** Defaults to everything billed plus free. Lower means short delivery. */
  receivedQty?: number;
  priceBasis: 'pack' | 'unit';
  price: number;
  discountAmount?: number;
  discountBp?: number;
  vatRateBp: number;
  /** The VAT printed on the paper, when it differs from the calculation. */
  vatOverride?: number;
}

export interface BillLineResult {
  billedQty: number;
  gross: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
  /** Paid and free together: what the net cost is spread over. */
  costQty: number;
  stockQty: number;
  stockValue: number;
}

export interface BillTotals {
  lines: BillLineResult[];
  gross: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
}

const count = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid ${what}`);
  return n;
};

/** Shares a whole amount by value, largest remainder first, so the shares always add up exactly. */
function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - shares.reduce((s, x) => s + x, 0);
  const order = weights.map((w, i) => ({ i, rem: (total * w) % sum })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]!++;
    left--;
  }
  return shares;
}

export function computeBill(lines: BillLineInput[], billDiscount: number, billCharge: number): BillTotals {
  count(billDiscount, 'bill discount');
  count(billCharge, 'bill charge');
  const first = lines.map((l) => {
    if (!Number.isSafeInteger(l.unitsPerPack) || l.unitsPerPack <= 0) throw new RangeError('Pack size must be more than zero');
    const packs = count(l.packs, 'number of packs');
    const looseQty = count(l.looseQty, 'loose quantity');
    const freeQty = count(l.freeQty, 'free quantity');
    const price = count(l.price, 'price');
    const billedQty = packs * l.unitsPerPack + looseQty;
    const costQty = billedQty + freeQty;
    if (costQty <= 0) throw new RangeError('A line needs a quantity');
    const gross = l.priceBasis === 'pack' ? roundDiv(price * billedQty, l.unitsPerPack) : roundDiv(price * billedQty, MILLI_PER_UNIT);
    const discount = l.discountAmount !== undefined ? count(l.discountAmount, 'discount') : roundDiv(gross * count(l.discountBp ?? 0, 'discount'), 10_000);
    if (discount > gross) throw new RangeError('The discount is larger than the line');
    const stockQty = l.receivedQty ?? costQty;
    count(stockQty, 'received quantity');
    if (stockQty > costQty) throw new RangeError('More received than billed. Enter the extra as free.');
    return { billedQty, gross, discount, base: gross - discount, costQty, stockQty };
  });
  const goods = first.reduce((s, l) => s + l.base, 0);
  if (billDiscount > goods) throw new RangeError('The bill discount is larger than the goods');
  const weights = first.map((l) => l.base);
  const less = spread(billDiscount, weights);
  const plus = spread(billCharge, weights);
  const done: BillLineResult[] = first.map((l, i) => {
    const input = lines[i]!;
    const net = l.base - less[i]! + plus[i]!;
    const vat = input.vatOverride !== undefined ? count(input.vatOverride, 'VAT') : roundDiv(net * count(input.vatRateBp, 'VAT rate'), 10_000);
    return {
      billedQty: l.billedQty, gross: l.gross, discount: l.discount, net, vat, total: net + vat, costQty: l.costQty, stockQty: l.stockQty,
      stockValue: l.stockQty === l.costQty ? net : roundDiv(net * l.stockQty, l.costQty),
    };
  });
  const sum = (f: (l: BillLineResult) => number) => done.reduce((s, l) => s + f(l), 0);
  return { lines: done, gross: sum((l) => l.gross), discount: sum((l) => l.discount) + billDiscount, net: sum((l) => l.net), vat: sum((l) => l.vat), total: sum((l) => l.total) };
}

/**
 * Stock cost is whole halalas per piece, so a value that does not divide evenly goes in as two rows at neighbouring
 * costs: 118.29 over 24 pieces = 21 at 4.93 + 3 at 4.92 = 118.29. Stock value then equals the bill exactly.
 */
export function splitCost(value: number, qty: number): { qty: number; unitCost: number }[] {
  if (qty <= 0) return [];
  const scaled = value * MILLI_PER_UNIT;
  const low = Math.floor(scaled / qty);
  const atHigh = scaled - qty * low;
  return [{ qty: atHigh, unitCost: low + 1 }, { qty: qty - atHigh, unitCost: low }].filter((r) => r.qty > 0);
}
