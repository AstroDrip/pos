// All dates are Saudi business days, written YYYY-MM-DD.

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom';

export interface Period {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export const PERIOD_CHOICES: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

export const riyadhToday = (now: Date = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** The Saudi retail week starts on Sunday. */
export const weekStart = (day: string) => addDays(day, -weekday(day));
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfPrevMonth = (day: string) => addDays(monthStart(day), -1);

export const validDay = (s: string | undefined): s is string => {
  if (!s || !DAY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const samePeriodBefore = (from: string, to: string) => {
  const n = dayDiff(from, to) + 1;
  return { prevFrom: addDays(from, -n), prevTo: addDays(from, -1) };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const shortMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
export const rangeLabel = (from: string, to: string) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

/** A bad or missing value falls back to This month. It never throws and never reaches a query unchecked. */
export function parsePeriod(params: Record<string, string | string[] | undefined>, today: string): Period {
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
  const key = one('p');
  const make = (k: PeriodKey, label: string, from: string, to: string, prev = samePeriodBefore(from, to)): Period => ({ key: k, label, from, to, ...prev });
  switch (key) {
    case 'today':
      return make('today', 'Today', today, today);
    case 'yesterday': {
      const y = addDays(today, -1);
      return make('yesterday', 'Yesterday', y, y);
    }
    case 'week': {
      const s = weekStart(today);
      return make('week', 'This week', s, today, { prevFrom: addDays(s, -7), prevTo: addDays(today, -7) });
    }
    case 'last_month': {
      const to = lastOfPrevMonth(today);
      const from = monthStart(to);
      const prevTo = lastOfPrevMonth(from);
      return make('last_month', 'Last month', from, to, { prevFrom: monthStart(prevTo), prevTo });
    }
    case 'custom': {
      const from = one('from');
      const to = one('to');
      if (validDay(from) && validDay(to) && from <= to && to <= today && dayDiff(from, to) < MAX_DAYS) return make('custom', 'Custom', from, to);
      break;
    }
  }
  const from = monthStart(today);
  const prevTo = lastOfPrevMonth(today);
  const prevFrom = monthStart(prevTo);
  const elapsed = dayDiff(from, today);
  const same = addDays(prevFrom, elapsed);
  return make('month', 'This month', from, today, { prevFrom, prevTo: same < prevTo ? same : prevTo });
}
