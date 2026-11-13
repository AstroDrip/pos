import { SearchBox } from '@/components/SearchBox';
import { CategoryTile, EmptyState, PageHeader } from '@/components/shop-parts';
import { listCategories } from '@/server/catalog-core';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function Categories() {
  const categories = await listCategories(shopDb());
  return (
    <>
      <PageHeader title="Categories" back="/" />
      <div className="lg:hidden"><SearchBox /></div>
      {categories.length === 0 ? (
        <EmptyState title="Nothing here yet">Products will appear as soon as the store adds them.</EmptyState>
      ) : (
        <ul className="mt-4 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
          {categories.map((c) => <li key={c.id}><CategoryTile category={c} /></li>)}
        </ul>
      )}
    </>
  );
}
