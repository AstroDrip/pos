import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ProductGrid } from '@/components/ProductGrid';
import { EmptyState, PageHeader, StaleNotice } from '@/components/shop-parts';
import { SortSelect } from '@/components/SortSelect';
import { listCategories, listProducts, type ProductSort } from '@/server/catalog-core';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

const SORTS: ProductSort[] = ['recommended', 'name', 'price_asc', 'price_desc'];

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string; stock?: string }> }) {
  const { id } = await params;
  const search = await searchParams;
  const categoryId = /^\d{1,12}$/.test(id) ? Number(id) : 0;
  const sort = SORTS.find((s) => s === search.sort) ?? 'recommended';
  const inStockOnly = search.stock === '1';
  const db = shopDb();
  const [categories, result] = await Promise.all([listCategories(db), listProducts(db, { categoryId, sort, inStockOnly, limit: 24 })]);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) notFound();

  const keep = (categoryHref: number) => `/categories/${categoryHref}?${new URLSearchParams({ sort, ...(inStockOnly ? { stock: '1' } : {}) })}`;
  const toggle = `/categories/${categoryId}?${new URLSearchParams({ sort, ...(inStockOnly ? {} : { stock: '1' }) })}`;
  const query = new URLSearchParams({ categoryId: String(categoryId), sort, ...(inStockOnly ? { stock: '1' } : {}) }).toString();
  const pill = (active: boolean) => `inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium ${active ? 'border-brand-900 bg-brand-900 text-white' : 'border-line text-ink-900 hover:bg-surface-soft'}`;

  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <aside className="hidden pt-6 lg:block">
        <h2 className="text-sm font-semibold text-ink-600">Categories</h2>
        <ul className="mt-2">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={keep(c.id)} aria-current={c.id === categoryId ? 'page' : undefined} className={`flex min-h-11 items-center justify-between rounded-nav px-3 text-sm font-medium ${c.id === categoryId ? 'bg-brand-100 text-brand-900' : 'hover:bg-surface-soft'}`}>
                {c.name}<span className="text-xs text-ink-600">{c.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0">
        <PageHeader title={category.name} back="/categories" />
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden">
          {categories.map((c) => (
            <li key={c.id} className="shrink-0"><Link href={keep(c.id)} aria-current={c.id === categoryId ? 'page' : undefined} className={pill(c.id === categoryId)}>{c.name}</Link></li>
          ))}
        </ul>
        <div className="mt-3 mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={toggle} aria-pressed={inStockOnly} className={pill(inStockOnly)}>In stock only</Link>
          <Suspense><SortSelect value={sort} /></Suspense>
        </div>
        <StaleNotice fresh={result.stockFresh} />
        {result.items.length === 0 ? (
          <EmptyState title="Nothing to show">{inStockOnly ? 'Everything in this category is out of stock right now.' : 'This category has no products yet.'}</EmptyState>
        ) : (
          <ProductGrid key={query} initial={result.items} total={result.total} query={query} />
        )}
      </div>
    </div>
  );
}
