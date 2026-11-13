import { ProductGrid } from '@/components/ProductGrid';
import { SearchBox } from '@/components/SearchBox';
import { EmptyState, PageHeader, StaleNotice } from '@/components/shop-parts';
import { listProducts } from '@/server/catalog-core';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim().slice(0, 80) ?? '';
  const result = q ? await listProducts(shopDb(), { q, limit: 24 }) : null;
  return (
    <>
      <PageHeader title={q ? `Results for “${q}”` : 'Search'} back="/" />
      <div className="mb-4 lg:hidden"><SearchBox key={q} initial={q} /></div>
      {result && <StaleNotice fresh={result.stockFresh} />}
      {!q && <EmptyState title="What are you looking for?">Search by product name, category or barcode.</EmptyState>}
      {result && result.items.length === 0 && <EmptyState title="No products found">Try a shorter word, or browse the categories.</EmptyState>}
      {result && result.items.length > 0 && <ProductGrid key={q} initial={result.items} total={result.total} query={new URLSearchParams({ q }).toString()} />}
    </>
  );
}
