import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ShopCategory } from '@/server/catalog-core';
import { ProductImage } from './ProductCard';
import { BackIcon } from './icons';

/** heading=false when the page has its own main heading, for example a product name. */
export function PageHeader({ title, back, heading = true }: { title: string; back: string; heading?: boolean }) {
  const Title = heading ? 'h1' : 'p';
  return (
    <header className="flex items-center gap-2 py-3">
      <Link href={back} aria-label="Back" className="-ml-2 flex size-11 items-center justify-center rounded-full hover:bg-surface-soft lg:hidden"><BackIcon /></Link>
      <Title className="truncate text-xl font-bold lg:text-2xl">{title}</Title>
    </header>
  );
}

export function StaleNotice({ fresh }: { fresh: boolean }) {
  if (fresh) return null;
  return <p role="status" className="my-3 rounded-field bg-surface-soft p-3 text-sm text-warning">We cannot confirm live stock right now. You can still browse, and online ordering will reopen shortly.</p>;
}

export function CategoryTile({ category }: { category: ShopCategory }) {
  return (
    <Link href={`/categories/${category.id}`} className="block rounded-card text-center focus-visible:outline-2 focus-visible:outline-brand-700">
      <ProductImage src={category.imageUrl} alt="" />
      <span className="mt-2 line-clamp-2 block text-sm leading-5 font-medium">{category.name}</span>
    </Link>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-16 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mx-auto mt-2 max-w-sm text-ink-600">{children}</div>
    </div>
  );
}

/** Shown on every page in demo mode, so nobody mistakes it for a real shop. */
export function DemoBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <p role="note" className="bg-brand-900 px-4 py-2 text-center text-sm text-white">Demo shop with made-up products. Orders are not real and may disappear.</p>;
}
