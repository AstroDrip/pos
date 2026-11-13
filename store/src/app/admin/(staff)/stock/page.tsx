import { AutoRefresh } from '@/components/admin/AdminNav';
import { Card, when } from '@/components/admin/parts';
import { ResolveButton } from '@/components/admin/ResolveButton';
import { syncHealth } from '@/server/admin-core';
import { shopDb } from '@/server/routes';
import { getSettings } from '@/server/settings-core';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';

const KIND: Record<string, { title: string; help: string }> = {
  shortage: { title: 'Less on the shelf than held online', help: 'The POS sold stock that online orders were holding. Check the shelf, then accept, wait or reject those orders.' },
  checkpoint: { title: 'Daily count did not match', help: 'The POS count was different from the website. The POS number was used. Check why, for example a sale while offline.' },
  reservation_sum: { title: 'Held total does not add up', help: 'The amount held for a product does not equal its open orders. Tell your developer; this should not happen.' },
};
const units = (n: number) => String(n / 1000);

export default async function StockSync() {
  const user = await requireStaff();
  const db = shopDb();
  const [h, settings] = await Promise.all([syncHealth(db, user), getSettings(db)]);
  const canResolve = user.permissions.has('stock.override');
  const staleMs = settings.staleMinutes * 60_000;

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={20_000} />
      <h1 className="text-2xl font-bold">Stock and sync</h1>

      <Card title="POS connection">
        {h.devices.length === 0 ? <p className="text-ink-600">No POS has connected yet.</p> : (
          <ul className="divide-y divide-line">
            {h.devices.map((d, i) => {
              const upToDate = d.status === 'active' && !d.needsCheckpoint && d.lastSeenAt !== null && Date.now() - Date.parse(d.lastSeenAt) < staleMs;
              // Being up to date needs contact, so contact is never older than that.
              const contact = [d.lastContactAt, d.lastSeenAt].filter((x): x is string => x !== null).sort().at(-1);
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{d.name}{d.status !== 'active' ? ' (switched off)' : ''}</p>
                    <p className="text-sm text-ink-600">Last contact {contact ? when(contact) : 'never'} · Fully up to date {d.lastSeenAt ? when(d.lastSeenAt) : 'never'}</p>
                    {d.epoch > 0 && <p className="text-sm text-ink-600">Restored from a backup {d.epoch} {d.epoch === 1 ? 'time' : 'times'}</p>}
                  </div>
                  <p className={`text-sm font-semibold ${upToDate ? 'text-success' : 'text-warning'}`}>
                    {upToDate ? 'Up to date' : d.needsCheckpoint ? 'Waiting for a full stock count from the POS' : 'Out of date. Online ordering is paused'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={`Stock differences to check: ${h.discrepancies.length}`}>
        {h.discrepancies.length === 0 ? <p className="text-ink-600">Nothing to check.</p> : (
          <ul className="divide-y divide-line">
            {h.discrepancies.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.name ?? `Product ${d.productId}`} <span className="font-normal text-ink-600">{d.sku}</span></p>
                  <p className="text-sm">{KIND[d.kind]!.title}: expected {units(d.expected)}, found {units(d.actual)}</p>
                  <p className="text-sm text-ink-600">{KIND[d.kind]!.help}</p>
                  <p className="text-xs text-ink-600">{when(d.createdAt)}</p>
                </div>
                {canResolve && <ResolveButton id={d.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Sync messages set aside: ${h.parked.length}`}>
        {h.parked.length === 0 ? <p className="text-ink-600">None.</p> : (
          <>
            <p className="mb-2 text-sm text-ink-600">These came from the POS but could not be used, so they were kept aside instead of stopping the sync. Tell your developer.</p>
            <ul className="divide-y divide-line text-sm">
              {h.parked.map((p) => <li key={p.eventId} className="py-2">{p.type}: {p.error} · {when(p.receivedAt)}</li>)}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
