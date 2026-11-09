// Money arrives as integer halalas and is never put through floating point. Missing is never shown as zero.

export const NOT_AVAILABLE = 'Not available';

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatSar(halalas: number | null | undefined): string {
  if (halalas === null || halalas === undefined) return NOT_AVAILABLE;
  const abs = Math.abs(halalas);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${halalas < 0 ? '−' : ''}SAR ${group(String(whole))}.${frac}`;
}

/** A shorter form for chart axes: SAR 12.3K */
export function formatSarShort(halalas: number): string {
  const whole = Math.floor(Math.abs(halalas) / 100);
  const sign = halalas < 0 ? '−' : '';
  if (whole < 1_000) return `${sign}${whole}`;
  if (whole < 1_000_000) return `${sign}${group(String(Math.floor(whole / 1_000)))}${whole < 10_000 && whole % 1_000 >= 100 ? `.${Math.floor((whole % 1_000) / 100)}` : ''}K`;
  return `${sign}${Math.floor(whole / 1_000_000)}.${Math.floor((whole % 1_000_000) / 100_000)}M`;
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? NOT_AVAILABLE : group(String(n));
}

/** Quantity is thousandths of a unit. Trailing zeros are dropped: 1.5, not 1.500. */
export function formatQty(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return NOT_AVAILABLE;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${milli < 0 ? '−' : ''}${group(String(whole))}${frac ? `.${frac}` : ''}`;
}

/** Whole-number division that rounds half up, for an average that must not use floats. */
export function divRound(a: number, b: number): number {
  const q = Math.floor(a / b);
  return (a - q * b) * 2 >= b ? q + 1 : q;
}

/** A percentage change, one decimal place, from integers only. Null when there is nothing to compare with. */
export function percentChange(now: number | null, before: number | null): string | null {
  if (now === null || before === null || before === 0) return null;
  const tenths = divRound(Math.abs(now - before) * 1000, Math.abs(before));
  return `${now >= before ? '+' : '−'}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}
