import Link from 'next/link';
import { formatMoney } from '../../../../../src/core/money';
import { AutoRefresh } from '@/components/admin/AdminNav';
import { Card, PaymentText, StatusBadge, TextLink, when } from '@/components/admin/parts';
import { adminSummary, listOrders } from '@/server/admin-core';
import { shopDb } from '@/server/routes';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const user = await requireStaff();
  const db = shopDb();
  const [s, waiting] = await Promise.all([adminSummary(db, user), listOrders(db, user, { status: 'placed', limit: 10 })]);
  const c = (k: keyof typeof s.counts) => s.counts[k] ?? 0;
  const inProgress = c('accepted') + c('preparing') + c('ready_for_pickup') + c('out_for_delivery');

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <h1 className="text-2xl font-bold">Today</h1>

      {!s.sync.fresh && (
        <p role="alert" className="rounded-card bg-surface p-4 text-warning">
          The POS last synced {s.sync.lastSeenAt ? when(s.sync.lastSeenAt) : 'never'}. Online ordering is paused and orders cannot be accepted until it reconnects.
        </p>
      )}

      <Card title={`New orders waiting: ${c('placed')}`} action={<TextLink href="/admin/orders?status=placed">See all</TextLink>}>
        {waiting.items.length === 0 ? (
          <p className="text-ink-600">Nothing is waiting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {waiting.items.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 hover:bg-surface-soft">
                  <span className="font-semibold tracking-wide">{o.publicRef}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-600">{o.customerName} · {o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(o.totalIncl)}</span>
                  <span className="text-sm text-ink-600">{when(o.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="In progress">
          <p className="text-3xl font-bold tabular-nums">{inProgress}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {(['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'] as const).map((k) => (
              <li key={k}><Link href={`/admin/orders?status=${k}`} className="flex min-h-11 items-center justify-between hover:underline"><StatusBadge status={k} /><span className="tabular-nums">{c(k)}</span></Link></li>
            ))}
          </ul>
        </Card>
        <Card title="Stock and sync" action={<TextLink href="/admin/stock">Open</TextLink>}>
          <p className={s.sync.fresh ? 'text-success' : 'text-warning'}>{s.sync.fresh ? 'POS connected' : 'POS out of date'}</p>
          <p className="text-sm text-ink-600">Last heard {s.sync.lastSeenAt ? when(s.sync.lastSeenAt) : 'never'}</p>
          <p className="mt-2 text-sm">Stock differences to check: <span className="font-semibold">{s.openDiscrepancies}</span></p>
          <p className="text-sm">Sync messages set aside: <span className="font-semibold">{s.sync.parked}</span></p>
        </Card>
        <Card title="Last day">
          <ul className="space-y-1 text-sm">
            {(['completed', 'rejected', 'cancelled', 'expired'] as const).map((k) => (
              <li key={k}><Link href={`/admin/orders?status=${k}`} className="flex min-h-11 items-center justify-between hover:underline"><StatusBadge status={k} /><span className="tabular-nums">{c(k)}</span></Link></li>
            ))}
          </ul>
          {s.paymentProblems > 0 && <p className="mt-2"><PaymentText status="failed" />: {s.paymentProblems}</p>}
        </Card>
      </div>
    </div>
  );
}
