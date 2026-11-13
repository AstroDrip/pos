import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OrderStatus } from '@/domain/order-machine';
import type { PaymentStatus } from '@/domain/payment-machine';
import { PAYMENT_TEXT } from '@/domain/order-text';

// Staff wording, from docs/ecommerce/ORDER_AND_PAYMENT_STATE_MACHINE.md. Status is always written, never shown by colour alone.
export const STAFF_STATUS: Record<OrderStatus, string> = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const TONE: Record<OrderStatus, string> = {
  placed: 'bg-leaf-500 text-ink-900',
  accepted: 'bg-brand-100 text-brand-900',
  preparing: 'bg-brand-100 text-brand-900',
  ready_for_pickup: 'bg-brand-900 text-white',
  out_for_delivery: 'bg-brand-900 text-white',
  completed: 'bg-surface-soft text-ink-600',
  rejected: 'bg-surface-soft text-danger',
  cancelled: 'bg-surface-soft text-ink-600',
  expired: 'bg-surface-soft text-ink-600',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[status]}`}>{STAFF_STATUS[status]}</span>;
}

export function PaymentText({ status }: { status: PaymentStatus }) {
  return <span className={`text-sm whitespace-nowrap ${status === 'failed' ? 'text-danger' : 'text-ink-600'}`}>{PAYMENT_TEXT[status]}</span>;
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-4 lg:p-5">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">{children}</Link>;
}

export const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
