'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney } from '../../../src/core/money';
import { STEP_LABEL } from '@/domain/order-text';
import type { CustomerOrder } from '@/server/order-core';
import { readDeviceOrders, type DeviceOrder } from './device-orders';
import { EmptyState } from './shop-parts';

type Row = DeviceOrder & { order: CustomerOrder | null };

export function DeviceOrderList() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const saved = readDeviceOrders();
    void Promise.all(
      saved.map(async (o) => {
        try {
          const r = await fetch(`/api/store/orders/${o.ref}`, { headers: { 'x-order-token': o.token }, cache: 'no-store' });
          return { ...o, order: r.ok ? ((await r.json()) as CustomerOrder) : null };
        } catch {
          return { ...o, order: null };
        }
      }),
    ).then(setRows);
  }, []);

  if (rows === null) return <p className="py-16 text-center text-ink-600">Loading your orders</p>;
  if (rows.length === 0) return <EmptyState title="No orders yet">Orders you place on this device will appear here.</EmptyState>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.ref}>
          <Link href={`/orders/${r.ref}#${r.token}`} className="flex min-h-11 items-center justify-between gap-4 rounded-card border border-line p-4 hover:bg-surface-soft">
            <span>
              <span className="block font-bold tracking-wide">{r.ref}</span>
              <span className="block text-sm text-ink-600">{new Date(r.placedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </span>
            <span className="text-right">
              <span className="block text-sm font-semibold">{r.order ? STEP_LABEL[r.order.status] : 'Could not load'}</span>
              {r.order && <span className="block text-sm text-ink-600 tabular-nums">{formatMoney(r.order.totalIncl)}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
