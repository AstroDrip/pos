// One definition of financial status, used for customer invoices, supplier invoices and expenses.
// The UI shows each status with the same icon, label and colour everywhere (renderer/StatusBadge.tsx).

export type FinStatus =
  | 'paid'
  | 'partial'
  | 'unpaid'
  | 'overdue'
  | 'due_soon'
  | 'no_due'
  | 'advance'
  | 'overpaid'
  | 'disputed'
  | 'reversed'
  | 'draft';

export interface StatusInput {
  total: number; // amount of the document (halalas)
  open: number; // still owed on it
  dueDate: string | null; // YYYY-MM-DD, null = no due date
  today: string; // YYYY-MM-DD (Saudi business day)
  dueSoonDays: number;
  disputed?: boolean;
  reversed?: boolean;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Priority: reversed > paid > disputed > overdue > due soon > partial > unpaid/no due date.
 * A fully settled document is always "paid" (never shows an outstanding indicator).
 * A document without a due date is never overdue.
 */
export function finStatus(i: StatusInput): FinStatus {
  if (i.reversed) return 'reversed';
  if (i.open <= 0) return 'paid';
  if (i.disputed) return 'disputed';
  if (i.dueDate !== null) {
    if (i.dueDate < i.today) return 'overdue';
    if (i.dueDate <= addDays(i.today, i.dueSoonDays)) return 'due_soon';
  }
  if (i.open < i.total) return 'partial';
  return i.dueDate === null ? 'no_due' : 'unpaid';
}

/** Ageing bucket of an open amount by its due date (not by payment dates). */
export type AgeBucket = 'noDue' | 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'over90';
export function ageBucket(dueDate: string | null, asOf: string): AgeBucket {
  if (dueDate === null) return 'noDue';
  const late = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000;
  if (late <= 0) return 'notDue';
  if (late <= 30) return 'd1_30';
  if (late <= 60) return 'd31_60';
  if (late <= 90) return 'd61_90';
  return 'over90';
}

/** Oldest-first allocation suggestion (shown to the user before confirming; never applied silently). */
export function suggestAllocation<T extends { id: number; open: number }>(items: T[], amount: number): { id: number; amount: number }[] {
  const out: { id: number; amount: number }[] = [];
  let left = amount;
  for (const it of items) {
    if (left <= 0) break;
    const a = Math.min(left, it.open);
    if (a > 0) out.push({ id: it.id, amount: a });
    left -= a;
  }
  return out;
}
