// Money is always an integer number of halalas (1 SAR = 100 halalas).
// Quantities are integer milli-units: grams for kg items, 1000 per piece.
// Rates are basis points: 15% = 1500.
// No floating point is used for any authoritative amount.

export type Halalas = number;
export type Milli = number;
export type BasisPoints = number;

export const MILLI_PER_UNIT = 1000;
export const BP_PER_WHOLE = 10_000;

export function assertSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * Integer division rounded half away from zero.
 * roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3.
 */
export function roundDiv(numerator: number, denominator: number): number {
  assertSafeInt(numerator, 'numerator');
  assertSafeInt(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const q = Math.floor(abs / denominator);
  const r = abs - q * denominator;
  return sign * (r * 2 >= denominator ? q + 1 : q);
}

/** Price for a quantity: unit price (halalas per whole unit) x qty (milli-units). */
export function extendPrice(unitPrice: Halalas, qty: Milli): Halalas {
  assertSafeInt(unitPrice, 'unitPrice');
  assertSafeInt(qty, 'qty');
  const product = unitPrice * qty;
  assertSafeInt(product, 'unitPrice x qty');
  return roundDiv(product, MILLI_PER_UNIT);
}

/** Parse "12.5" or "12.50" SAR into halalas without floating point. */
export function parseSar(text: string): Halalas {
  const m = /^\s*(-)?(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) throw new RangeError(`Invalid SAR amount: "${text}"`);
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(2, '0'));
  const value = whole * 100 + frac;
  return m[1] ? -value : value;
}

/** For headline figures: SAR 1,234.50 */
export function formatMoney(amount: Halalas): string {
  const s = formatSar(amount);
  const negative = s.startsWith('-');
  const [whole, frac] = (negative ? s.slice(1) : s).split('.') as [string, string];
  return `${negative ? '-' : ''}SAR ${whole.replace(/\B(?=(\d{3})+$)/g, ',')}.${frac}`;
}

export function formatSar(amount: Halalas): string {
  assertSafeInt(amount, 'amount');
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Parse a decimal quantity like "1.25" (kg) or "3" (pieces) into milli-units. */
export function parseQty(text: string): Milli {
  const m = /^\s*(\d{1,7})(?:\.(\d{1,3}))?\s*$/.exec(text);
  if (!m) throw new RangeError(`Invalid quantity: "${text}"`);
  return Number(m[1]) * MILLI_PER_UNIT + Number((m[2] ?? '').padEnd(3, '0'));
}

export function formatQty(qty: Milli, decimals: 0 | 3 = 3): string {
  assertSafeInt(qty, 'qty');
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(qty);
  const whole = Math.floor(abs / MILLI_PER_UNIT);
  if (decimals === 0 && abs % MILLI_PER_UNIT === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(abs % MILLI_PER_UNIT).padStart(3, '0')}`;
}
