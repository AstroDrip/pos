import { nextDay } from './store-time';

// Date choices for report screens. All days are Saudi business days, written YYYY-MM-DD.

export interface DayRange {
  from: string;
  to: string;
}

export type DayPreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month';

export const DAY_PRESETS: { id: DayPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysApart = (a: string, b: string): number => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthEnd = (day: string) => addDays(monthStart(addDays(monthStart(day), 32)), -1);
const weekStart = (day: string) => addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay()); // the Saudi retail week starts on Sunday

export function presetRange(p: DayPreset, today: string): DayRange {
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week':
      return { from: weekStart(today), to: today };
    case 'month':
      return { from: monthStart(today), to: today };
    case 'last_month': {
      const to = addDays(monthStart(today), -1);
      return { from: monthStart(to), to };
    }
  }
}

export const presetOf = (r: DayRange, today: string): DayPreset | null => DAY_PRESETS.find((p) => {
  const x = presetRange(p.id, today);
  return x.from === r.from && x.to === r.to;
})?.id ?? null;

const isWholeMonth = (r: DayRange, today: string) => r.from === monthStart(r.from) && (r.to === monthEnd(r.from) || (r.to === today && monthStart(r.to) === r.from));

/** Moves a range back or forward by its own length, or a whole month for a month. The end never passes today. */
export function shiftRange(r: DayRange, direction: -1 | 1, today: string): DayRange {
  if (isWholeMonth(r, today)) {
    const from = direction < 0 ? monthStart(addDays(r.from, -1)) : addDays(monthEnd(r.from), 1);
    if (from > today) return r;
    const end = monthEnd(from);
    return { from, to: end > today ? today : end };
  }
  const n = daysApart(r.from, r.to) + 1;
  const from = addDays(r.from, direction * n);
  if (from > today) return r;
  const to = addDays(r.to, direction * n);
  return { from, to: to > today ? today : to };
}

/** The days to show in the date strip: a window around the end of the selection, never past today. */
export function stripDays(r: DayRange, today: string, before = 45, after = 15): string[] {
  const last = addDays(r.to, after) > today ? today : addDays(r.to, after);
  const days: string[] = [];
  for (let d = addDays(r.to, -before); d <= last; d = nextDay(d)) days.push(d);
  return days;
}

export const inRange = (day: string, r: DayRange): boolean => day >= r.from && day <= r.to;

/** Clicking a day picks it. With Shift, the selection stretches from where it was. */
export function pickDay(day: string, r: DayRange, extend: boolean): DayRange {
  if (!extend) return { from: day, to: day };
  return day < r.from ? { from: day, to: r.to } : { from: r.from, to: day };
}

/** One step left or right from the end of the selection, kept to one day and to today. */
export function stepDay(r: DayRange, direction: -1 | 1, today: string): DayRange {
  const d = addDays(r.to, direction);
  return d > today ? { from: r.to, to: r.to } : { from: d, to: d };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const weekdayOf = (day: string): string => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
export const monthOf = (day: string): string => MONTHS[Number(day.slice(5, 7)) - 1]!;
/** 8 Nov 2026 */
export const longDay = (day: string): string => `${Number(day.slice(8))} ${monthOf(day)} ${day.slice(0, 4)}`;
export const shortDay = (day: string): string => `${Number(day.slice(8))} ${monthOf(day)}`;
export const rangeText = (r: DayRange): string => (r.from === r.to ? longDay(r.from) : `${shortDay(r.from)} – ${longDay(r.to)}`);

export const validRange = (v: unknown): v is DayRange => {
  const x = v as DayRange | null;
  return typeof x === 'object' && x !== null && /^\d{4}-\d{2}-\d{2}$/.test(String(x.from)) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.to)) && x.from <= x.to;
};
