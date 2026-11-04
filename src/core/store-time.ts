// Business days follow Saudi time. Timestamps are stored in UTC; reports and journal dates use the store's day.
// Saudi Arabia is UTC+03:00 all year (no daylight saving time).
export const STORE_UTC_OFFSET_MIN = 180;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The store-local calendar day ("YYYY-MM-DD") of a UTC ISO timestamp. */
export function storeDay(isoUtc: string): string {
  const t = Date.parse(isoUtc);
  if (Number.isNaN(t)) throw new RangeError(`Invalid timestamp ${isoUtc}`);
  return new Date(t + STORE_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** UTC ISO timestamp of 00:00 store time on `day`. */
export function storeDayStartUtc(day: string): string {
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new RangeError(`Invalid day ${day}`);
  return new Date(Date.parse(`${day}T00:00:00Z`) - STORE_UTC_OFFSET_MIN * 60_000).toISOString();
}

/** The day after `day`. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** SQLite expression giving the store day of a UTC timestamp column. */
export const sqlStoreDay = (column: string) => `substr(datetime(${column}, '+${STORE_UTC_OFFSET_MIN} minutes'), 1, 10)`;
