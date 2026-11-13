import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FulfilmentPicker } from '@/components/FulfilmentPicker';
import { ProductRows } from '@/components/ProductCard';
import { SearchBox } from '@/components/SearchBox';
import { CategoryTile, StaleNotice } from '@/components/shop-parts';
import { activeBanner, listCategories, listDeliveryAreas, listProducts } from '@/server/catalog-core';
import { readEnv } from '@/server/env';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!(await cookies()).get('store_welcome')) redirect('/welcome');
  const db = shopDb();
  const [categories, featured, more, banner, areas] = await Promise.all([listCategories(db), listProducts(db, { featuredOnly: true, limit: 8 }), listProducts(db, { sort: 'name', limit: 8 }), activeBanner(db), listDeliveryAreas(db)]);

  return (
    <>
      <h1 className="sr-only">{readEnv().displayName}</h1>
      <div className="pt-3 lg:hidden">
        <FulfilmentPicker areas={areas} />
        <div className="mt-3"><SearchBox /></div>
      </div>
      <StaleNotice fresh={featured.stockFresh} />

      {banner && (
        <section className="relative mt-4 flex min-h-40 items-center overflow-hidden rounded-card bg-brand-900 p-5 text-white lg:mt-6 lg:min-h-64 lg:p-12">
          <div className="relative z-10 max-w-[58%]">
            <h2 className="text-xl leading-tight font-bold lg:text-4xl">{banner.title}</h2>
            <p className="mt-1 text-sm text-white/90 lg:mt-3 lg:text-lg">{banner.body}</p>
            {banner.link && <Link href={banner.link} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-surface px-5 text-sm font-semibold text-ink-900 lg:mt-5">Shop now</Link>}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {banner.imageUrl && <img src={banner.imageUrl} alt="" className="absolute -right-4 -bottom-4 w-[52%] max-w-60 lg:max-w-80" />}
        </section>
      )}

      <section className="mt-6 lg:mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold lg:text-xl">Shop by category</h2>
          <Link href="/categories" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-ink-600">See all</Link>
        </div>
        <ul className="mt-1 grid grid-cols-4 gap-x-3 gap-y-4 md:grid-cols-6 lg:grid-cols-9">
          {categories.map((c, i) => (
            <li key={c.id} className={i >= 8 ? 'hidden lg:block' : i >= 6 ? 'md:hidden lg:block' : ''}><CategoryTile category={c} /></li>
          ))}
        </ul>
      </section>

      {featured.items.length > 0 && (
        <section className="mt-8 lg:mt-12">
          <h2 className="mb-3 text-lg font-bold lg:text-xl">Fresh picks</h2>
          <ProductRows products={featured.items} />
        </section>
      )}

      {more.items.length > 0 && (
        <section className="mt-8 lg:mt-12">
          <h2 className="mb-3 text-lg font-bold lg:text-xl">More to shop</h2>
          <ProductRows products={more.items} />
        </section>
      )}
    </>
  );
}
