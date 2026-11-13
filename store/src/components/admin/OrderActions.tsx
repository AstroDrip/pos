'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { OrderStatus } from '@/domain/order-machine';
import { Button } from '../ui';

const LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept order',
  preparing: 'Start preparing',
  ready_for_pickup: 'Mark ready for pickup',
  completed: 'Mark delivered',
  rejected: 'Reject order',
  cancelled: 'Cancel order',
};
const NEEDS_REASON: OrderStatus[] = ['rejected', 'cancelled'];

interface Problem { sku: string | null; name: string | null; problem: string }

export function OrderActions({ orderId, version, actions }: { orderId: string; version: number; actions: OrderStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [asking, setAsking] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const send = async (to: OrderStatus, why?: string) => {
    setBusy(true);
    setMessage(null);
    setProblems([]);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, version, ...(why ? { reason: why } : {}) }) });
      const data = (await r.json()) as { message?: string; details?: Problem[] };
      if (!r.ok) {
        setMessage(data.message ?? 'That did not work.');
        setProblems(data.details ?? []);
      }
      dialog.current?.close();
      router.refresh();
    } catch {
      setMessage('Could not reach the server. Nothing was changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (actions.length === 0) return <p className="text-sm text-ink-600">No actions are open to you for this order now.</p>;
  const forward = actions.filter((a) => !NEEDS_REASON.includes(a));
  const stop = actions.filter((a) => NEEDS_REASON.includes(a));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {forward.map((a) => <Button key={a} type="button" disabled={busy} onClick={() => void send(a)}>{LABEL[a] ?? a}</Button>)}
        {stop.map((a) => <Button key={a} type="button" variant="secondary" disabled={busy} onClick={() => { setAsking(a); setReason(''); dialog.current?.showModal(); }}>{LABEL[a] ?? a}</Button>)}
      </div>
      {message && (
        <div role="alert" className="rounded-field bg-surface-soft p-3 text-sm">
          <p className="font-semibold text-danger">{message}</p>
          {problems.length > 0 && <ul className="mt-1 list-disc pl-5">{problems.map((p, i) => <li key={i}>{p.name ? <><span className="font-semibold">{p.name}</span> ({p.sku}): </> : null}{p.problem}</li>)}</ul>}
        </div>
      )}
      <dialog ref={dialog} aria-label={asking ? LABEL[asking] : 'Reason'} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card p-5 backdrop:bg-ink-900/40">
        <h2 className="text-lg font-bold">{asking ? LABEL[asking] : ''}</h2>
        <p className="mt-1 text-sm text-ink-600">The customer sees this reason. Any held stock goes back on sale.</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium">Reason</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="w-full rounded-field bg-surface-soft p-3 focus-visible:outline-2 focus-visible:outline-brand-700" />
        </label>
        <div className="mt-4 flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => dialog.current?.close()}>Back</Button>
          <Button type="button" className="flex-1" disabled={busy || !reason.trim() || !asking} onClick={() => asking && void send(asking, reason.trim())}>{asking ? LABEL[asking] : 'Confirm'}</Button>
        </div>
      </dialog>
    </div>
  );
}
