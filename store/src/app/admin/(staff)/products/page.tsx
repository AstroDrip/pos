import Link from 'next/link';
import { formatMoney } from '../../../../../../src/core/money';
import { Card } from '@/components/admin/parts';
import { ProductEditor } from '@/components/admin/ProductEditor';
import { ProductImage } from '@/components/ProductCard';
import { listProductsForStaff, productQuery } from '@/server/admin-core';
import { shopDb } from '@/server/routes';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';
const PAGE = 50;
const STATUS_TEXT = { published: 'Published', unpublished: 'Unpublished', archived: 'Archived' } as const;
const stockText = (n: number | null) => (n === null ? '—' : String(n / 1000));

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const raw = await searchParams;
  const clean = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v && ['q', 'status', 'offset'].includes(k))) as Record<string, string>;
  const parsed = productQuery.safeParse({ ...clean, limit: PAGE });
  const f = parsed.success ? parsed.data : productQuery.parse({ limit: PAGE });
  const r = await listProductsForStaff(shopDb(), user, f);
  const canPublish = user.permissions.has('products.publish');
  const field = 'min-h-11 w-full rounded-field bg-surface-soft px-3 focus-visible:outline-2 focus-visible:outline-brand-700';
  const page = (offset: number) => `/admin/products?${new URLSearchParams({ ...clean, offset: String(offset) })}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="text-sm text-ink-600">Names, prices, VAT and barcodes come from the POS. Change those in the POS. Here you choose what shows online and how it is described.</p>
      <Card>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" aria-label="Filter products">
          <label><span className="mb-1 block text-sm font-medium">Search</span><input name="q" defaultValue={f.q ?? ''} placeholder="Name or SKU" className={field} /></label>
          <label><span className="mb-1 block text-sm font-medium">Website status</span>
            <select name="status" defaultValue={f.status ?? ''} className={field}><option value="">All</option><option value="published">Published</option><option value="unpublished">Unpublished</option><option value="archived">Archived</option></select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-11 cursor-pointer rounded-full bg-brand-900 px-5 font-semibold text-white">Apply</button>
            <Link href="/admin/products" className="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-ink-600 hover:bg-surface-soft">Clear</Link>
          </div>
        </form>
      </Card>
      <Card>
        <p className="mb-2 text-sm text-ink-600">{r.total} products</p>
        <ul className="divide-y divide-line">
          {r.items.map((p) => (
            <li key={p.id}>
              <details className="group py-2">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="w-12 shrink-0"><ProductImage src={p.imageUrl} alt="" small /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="truncate text-sm text-ink-600">{p.sku}{p.categoryName ? ` · ${p.categoryName}` : ' · No category'} · {formatMoney(p.priceIncl)} / {p.unit}{p.posActive ? '' : ' · Stopped in the POS'}</p>
                  </div>
                  <div className="hidden text-right text-sm sm:block">
                    <p>On hand {stockText(p.onHand)} · Held {stockText(p.reserved)}</p>
                    <p className="font-semibold">Free online {stockText(p.available)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.status === 'published' ? 'bg-brand-100 text-brand-900' : 'bg-surface-soft text-ink-600'}`}>{STATUS_TEXT[p.status]}</span>
                </summary>
                <div className="mt-3 rounded-field bg-surface-soft/60 p-3 sm:ml-15">
                  <p className="mb-3 text-sm sm:hidden">On hand {stockText(p.onHand)} · Held {stockText(p.reserved)} · Free online {stockText(p.available)}</p>
                  <ProductEditor product={p} canPublish={canPublish} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        {r.total > PAGE && (
          <div className="mt-3 flex items-center justify-between">
            {f.offset > 0 ? <Link href={page(Math.max(0, f.offset - PAGE))} className="inline-flex min-h-11 items-center font-semibold text-brand-700">Previous</Link> : <span />}
            <span className="text-sm text-ink-600">{f.offset + 1}–{Math.min(f.offset + PAGE, r.total)} of {r.total}</span>
            {f.offset + PAGE < r.total ? <Link href={page(f.offset + PAGE)} className="inline-flex min-h-11 items-center font-semibold text-brand-700">Next</Link> : <span />}
          </div>
        )}
      </Card>
    </div>
  );
}
