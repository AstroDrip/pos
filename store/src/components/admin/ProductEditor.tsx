'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { StaffProduct } from '@/server/admin-core';
import { Button } from '../ui';

type Status = StaffProduct['status'];
const STATUS_TEXT: Record<Status, string> = { published: 'Published', unpublished: 'Unpublished', archived: 'Archived' };

/** Edits only the website's own fields. Name, price and VAT are shown, and changed in the POS. */
export function ProductEditor({ product, canPublish }: { product: StaffProduct; canPublish: boolean }) {
  const router = useRouter();
  const [description, setDescription] = useState(product.description);
  const [featured, setFeatured] = useState(product.featured);
  const [safety, setSafety] = useState(String(product.safetyStock / 1000));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/products/${product.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const data = (await r.json()) as { message?: string };
      setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: data.message ?? 'That did not save.' });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server. Nothing was saved.' });
    } finally {
      setBusy(false);
    }
  };

  const safetyMilli = Math.round(Number(safety) * 1000);
  const safetyOk = Number.isFinite(safetyMilli) && safetyMilli >= 0;
  const field = 'w-full rounded-field bg-surface-soft p-3 focus-visible:outline-2 focus-visible:outline-brand-700';

  return (
    <div className="space-y-3">
      {canPublish && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Website status">
          {(['published', 'unpublished', 'archived'] as Status[]).map((s) => (
            <button key={s} type="button" disabled={busy || product.status === s} aria-pressed={product.status === s} onClick={() => void save({ status: s }, `${STATUS_TEXT[s]}.`)}
              className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold disabled:cursor-default ${product.status === s ? 'border-brand-900 bg-brand-900 text-white' : 'border-line hover:bg-surface-soft'}`}>
              {STATUS_TEXT[s]}
            </button>
          ))}
        </div>
      )}
      <label className="block"><span className="mb-1 block text-sm font-medium">Website description</span>
        <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="size-4 accent-brand-900" />Show in Fresh picks</label>
        <label className="block w-40"><span className="mb-1 block text-sm font-medium">Keep back from online ({product.unit})</span>
          <input inputMode="decimal" value={safety} onChange={(e) => setSafety(e.target.value)} className={`min-h-11 ${field} py-0`} />
        </label>
        <Button type="button" disabled={busy || !safetyOk} onClick={() => void save({ description, featured, safetyStock: safetyMilli }, 'Saved.')}>Save</Button>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
    </div>
  );
}
