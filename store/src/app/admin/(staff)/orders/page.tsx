import Link from 'next/link';
import { formatMoney } from '../../../../../../src/core/money';
import { AutoRefresh } from '@/components/admin/AdminNav';
import { Card, PaymentText, STAFF_STATUS, StatusBadge, when } from '@/components/admin/parts';
import { ORDER_STATUSES } from '@/domain/order-machine';
import { listOrders, orderQuery } from '@/server/admin-core';
import { shopDb } from '@/server/routes';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const raw = await searchParams;
  const clean = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v && ['status', 'fulfilment', 'q', 'from', 'to', 'offset'].includes(k))) as Record<string, string>;
  const parsed = orderQuery.safeParse({ ...clean, limit: PAGE });
  const f = parsed.success ? parsed.data : orderQuery.parse({ limit: PAGE });
  const r = await listOrders(shopDb(), user, f);
  const page = (offset: number) => `/admin/orders?${new URLSearchParams({ ...clean, offset: String(offset) })}`;
  const field = 'min-h-11 w-full rounded-field bg-surface-soft px-3 focus-visible:outline-2 focus-visible:outline-brand-700';

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <h1 className="text-2xl font-bold">Orders</h1>
      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter orders">
          <label className="lg:col-span-2"><span className="mb-1 block text-sm font-medium">Search</span><input name="q" defaultValue={f.q ?? ''} placeholder="Order number, name or phone" className={field} /></label>
          <label><span className="mb-1 block text-sm font-medium">Status</span>
            <select name="status" defaultValue={f.status ?? ''} className={field}><option value="">All</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{STAFF_STATUS[s]}</option>)}</select>
          </label>
          <label><span className="mb-1 block text-sm font-medium">Type</span>
            <select name="fulfilment" defaultValue={f.fulfilment ?? ''} className={field}><option value="">All</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
          </label>
          <label><span className="mb-1 block text-sm font-medium">From</span><input type="date" name="from" defaultValue={f.from ?? ''} className={field} /></label>
          <label><span className="mb-1 block text-sm font-medium">To</span><input type="date" name="to" defaultValue={f.to ?? ''} className={field} /></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            <button type="submit" className="min-h-11 cursor-pointer rounded-full bg-brand-900 px-5 font-semibold text-white">Apply</button>
            <Link href="/admin/orders" className="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-ink-600 hover:bg-surface-soft">Clear</Link>
          </div>
        </form>
      </Card>

      <Card>
        <p className="mb-2 text-sm text-ink-600">{r.total} {r.total === 1 ? 'order' : 'orders'}</p>
        {r.items.length === 0 ? (
          <p className="py-8 text-center text-ink-600">No orders match.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block"><table className="w-full text-sm">
              <thead className="text-left text-ink-600">
                <tr className="border-b border-line">{['Order', 'Placed', 'Customer', 'Phone', 'Type', 'Location', 'Items', 'Total', 'Payment', 'Status', 'Staff'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {r.items.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface-soft">
                    <td className="py-2 pr-3"><Link href={`/admin/orders/${o.id}`} className="inline-flex min-h-11 items-center font-semibold tracking-wide whitespace-nowrap text-brand-700 hover:underline">{o.publicRef}</Link></td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(o.createdAt)}</td>
                    <td className="max-w-40 truncate py-2 pr-3">{o.customerName}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{o.phone}</td>
                    <td className="py-2 pr-3">{o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</td>
                    <td className="max-w-48 truncate py-2 pr-3">{o.location}</td>
                    <td className="py-2 pr-3 tabular-nums">{o.itemCount}</td>
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{formatMoney(o.totalIncl)}</td>
                    <td className="py-2 pr-3"><PaymentText status={o.paymentStatus} /></td>
                    <td className="py-2 pr-3"><StatusBadge status={o.status} /></td>
                    <td className="py-2 pr-3 text-ink-600">{o.assignedStaff ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <ul className="divide-y divide-line lg:hidden">
              {r.items.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="block py-3">
                    <span className="flex items-center justify-between gap-3"><span className="font-semibold tracking-wide">{o.publicRef}</span><StatusBadge status={o.status} /></span>
                    <span className="mt-1 block truncate text-sm text-ink-600">{o.customerName} · {o.phone}</span>
                    <span className="mt-1 flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{o.fulfilment === 'pickup' ? 'Pickup' : o.location} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</span><span className="shrink-0 font-semibold tabular-nums">{formatMoney(o.totalIncl)}</span></span>
                    <span className="mt-1 flex justify-between gap-3 text-sm"><PaymentText status={o.paymentStatus} /><span className="text-ink-600">{when(o.createdAt)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {r.total > PAGE && (
          <div className="mt-3 flex items-center justify-between">
            {f.offset > 0 ? <Link href={page(Math.max(0, f.offset - PAGE))} className="inline-flex min-h-11 items-center font-semibold text-brand-700">Newer</Link> : <span />}
            <span className="text-sm text-ink-600">{f.offset + 1}–{Math.min(f.offset + PAGE, r.total)} of {r.total}</span>
            {f.offset + PAGE < r.total ? <Link href={page(f.offset + PAGE)} className="inline-flex min-h-11 items-center font-semibold text-brand-700">Older</Link> : <span />}
          </div>
        )}
      </Card>
    </div>
  );
}
