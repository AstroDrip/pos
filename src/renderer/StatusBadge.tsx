import type { ReactElement } from 'react';
import type { FinStatus } from '../core/status';
import { useI18n } from './i18n';

// One look for every financial status (core/status.ts): icon + word + colour, never colour alone.
// Icons are small inline SVGs (no icon library is installed; adding one is not needed for 10 shapes).

const LABEL: Record<FinStatus | 'unpaid_expense' | 'cancelled', string> = {
  paid: 'Paid',
  partial: 'Partially paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  no_due: 'No due date',
  advance: 'Advance',
  overpaid: 'Overpaid',
  disputed: 'Disputed',
  reversed: 'Reversed',
  draft: 'Draft',
  unpaid_expense: 'Unpaid',
  cancelled: 'Cancelled',
};

const path = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
const ICON: Record<string, ReactElement> = {
  paid: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}{path('M8 12l3 3 5-6')}</>,
  partial: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}<path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" /></>,
  unpaid: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}{path('M12 7v5l3 2')}</>,
  overdue: <>{path('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z')}{path('M12 9v4')}{path('M12 17h.01')}</>,
  due_soon: <>{path('M3 6h18v15H3z')}{path('M3 10h18')}{path('M8 3v4M16 3v4')}{path('M12 14v3h2')}</>,
  no_due: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}{path('M8 12h8')}</>,
  advance: <>{path('M3 7h18v12H3z')}{path('M16 13h2')}{path('M3 7l3-4h12l3 4')}</>,
  overpaid: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}{path('M12 8v8M8 12h8')}</>,
  disputed: <>{path('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')}{path('M12 7v4')}{path('M12 14h.01')}</>,
  reversed: <>{path('M3 12a9 9 0 1 0 3-6.7L3 8')}{path('M3 3v5h5')}</>,
  draft: <>{path('M4 20h4L19 9l-4-4L4 16z')}</>,
  cancelled: <>{path('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z')}{path('M5 5l14 14')}</>,
};
const CLASS: Record<string, string> = { unpaid_expense: 'unpaid', cancelled: 'reversed' };

/** English label of a status (pass through t() to translate); the same words as the badges. */
export const statusLabel = (s: string) => LABEL[(s in LABEL ? s : 'unpaid') as keyof typeof LABEL];

export function StatusBadge({ status }: { status: FinStatus | 'unpaid_expense' | 'cancelled' | string }) {
  const { t } = useI18n();
  const key = (status in LABEL ? status : 'unpaid') as keyof typeof LABEL;
  return (
    <span className={`st st-${CLASS[key] ?? key}`} role="status">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">{ICON[key] ?? ICON[CLASS[key] ?? 'unpaid']}</svg>
      {t(LABEL[key])}
    </span>
  );
}

export function StatusLegend() {
  const { t } = useI18n();
  const all: FinStatus[] = ['paid', 'partial', 'unpaid', 'due_soon', 'overdue', 'no_due', 'advance', 'disputed', 'reversed'];
  return (
    <details className="legend">
      <summary>{t('What do the statuses mean?')}</summary>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{all.map((s) => <StatusBadge key={s} status={s} />)}</div>
    </details>
  );
}
