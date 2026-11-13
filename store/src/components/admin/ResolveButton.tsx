'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ResolveButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        className="min-h-11 cursor-pointer rounded-full border border-line px-4 text-sm font-semibold hover:bg-surface-soft disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await fetch(`/api/admin/discrepancies/${id}`, { method: 'POST' });
            if (!r.ok) setError(((await r.json()) as { message?: string }).message ?? 'Not saved.');
            router.refresh();
          } catch {
            setError('Could not reach the server.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Mark checked
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
