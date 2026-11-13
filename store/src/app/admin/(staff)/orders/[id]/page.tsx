import { notFound } from 'next/navigation';
import { formatMoney } from '../../../../../../../src/core/money';
import { AutoRefresh } from '@/components/admin/AdminNav';
import { OrderActions } from '@/components/admin/OrderActions';
import { Card, PaymentText, STAFF_STATUS, StatusBadge, TextLink, when } from '@/components/admin/parts';
import { ProductImage } from '@/components/ProductCard';
import { METHOD_TEXT } from '@/domain/order-text';
import { getOrderForStaff } from '@/server/admin-core';
import { ApiError } from '@/server/errors';
import { shopDb } from '@/server/routes';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';

const qty = (q: number, unit: string, mode: 'unit' | 'weight') => (mode === 'weight' ? `${q / 1000} ${unit}` : `${q / 1000}`);

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const o = await getOrderForStaff(shopDb(), user, id).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const pickup = o.fulfilment === 'pickup';
  const mapLink = !pickup && o.addressLine ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.addressLine, o.building, o.areaName].filter(Boolean).join(', '))}` : null;

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={15_000} />
      <TextLink href="/admin/orders">All orders</TextLink>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-wide">{o.publicRef}</h1>
        <StatusBadge status={o.status} />
        <span className="text-ink-600">{pickup ? 'Store pickup' : 'Delivery'} · placed {when(o.createdAt)}</span>
      </div>
      {o.status === 'placed' && o.expiresAt && <p className="text-sm text-warning">Expires {when(o.expiresAt)} if not accepted.</p>}

      <Card title="Actions"><OrderActions orderId={o.id} version={o.version} actions={o.actions} /></Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="Items and stock">
          <ul className="divide-y divide-line">
            {o.lines.map((l) => (
              <li key={l.productId} className="flex gap-3 py-3">
                <div className="w-14 shrink-0"><ProductImage src={l.imageUrl} alt="" small /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-x-3">
                    <p className="font-semibold">{l.name} <span className="font-normal text-ink-600">× {qty(l.qty, l.unit, l.sellMode)}</span></p>
                    <p className="tabular-nums">{l.isEstimate ? 'About ' : ''}{formatMoney(l.lineIncl)}</p>
                  </div>
                  <p className="text-sm text-ink-600">SKU {l.sku} · {formatMoney(l.unitPriceIncl)} each{l.priceNow !== null && l.priceNow !== l.unitPriceIncl ? ` · POS price is now ${formatMoney(l.priceNow)}` : ''}</p>
                  <p className="mt-1 text-sm">
                    <span className={l.stockNote.startsWith('Short') ? 'font-semibold text-danger' : l.stockNote === 'In stock' ? 'text-success' : 'text-warning'}>{l.stockNote}</span>
                    {l.onHand !== null && <span className="text-ink-600"> · on hand {l.onHand / 1000}, held online {(l.reserved ?? 0) / 1000}, free {(l.available ?? 0) / 1000}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-600">Items</dt><dd className="tabular-nums">{formatMoney(o.itemsIncl)}</dd></div>
            {!pickup && <div className="flex justify-between"><dt className="text-ink-600">Delivery</dt><dd className="tabular-nums">{o.deliveryFeeIncl === 0 ? 'Free' : formatMoney(o.deliveryFeeIncl)}</dd></div>}
            <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(o.totalIncl)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-600">Includes VAT</dt><dd className="tabular-nums">{formatMoney(o.totalVat)}</dd></div>
          </dl>
        </Card>

        <div className="space-y-4">
          <Card title="Customer">
            <p className="font-semibold">{o.customerName}</p>
            <p><a href={`tel:${o.phone}`} className="inline-flex min-h-11 items-center text-brand-700 hover:underline">{o.phone}</a></p>
            {!pickup && <p className="text-sm">{[o.addressLine, o.building, o.areaName].filter(Boolean).join(', ')}</p>}
            {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">Open in maps</a>}
            {o.locationNote && <p className="mt-1 text-sm text-ink-600">Note: {o.locationNote}</p>}
          </Card>
          <Card title="Payment">
            <p>{METHOD_TEXT[o.paymentMethod] ?? o.paymentMethod}</p>
            <PaymentText status={o.paymentStatus} />
            <p className="mt-1 text-sm text-ink-600">Paid {formatMoney(o.amountPaid)} · Outstanding {formatMoney(Math.max(0, o.totalIncl - o.amountPaid))}</p>
            {o.posInvoiceNo && <p className="mt-1 text-sm">POS invoice <span className="font-semibold">{o.posInvoiceNo}</span></p>}
          </Card>
          <Card title="History">
            <ol className="space-y-2 text-sm">
              {o.history.map((h, i) => (
                <li key={i}>
                  <p className="font-semibold">{STAFF_STATUS[h.status]}</p>
                  <p className="text-ink-600">{when(h.at)} · {h.staff ?? (h.actor === 'customer' ? 'Customer' : h.actor === 'pos' ? 'POS' : 'System')}</p>
                  {h.reason && <p className="text-ink-600">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
