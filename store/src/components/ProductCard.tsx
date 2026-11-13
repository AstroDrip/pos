import Link from 'next/link';
import { formatMoney } from '../../../src/core/money';
import type { Availability, ShopProduct } from '@/server/catalog-core';
import { AddToCart } from './AddToCart';
import { LeafIcon } from './icons';

export function ProductImage({ src, alt, className = '', small = false }: { src: string | null; alt: string; className?: string; small?: boolean }) {
  return (
    <div className={`flex aspect-square items-center justify-center overflow-hidden rounded-card bg-surface-soft ${className}`}>
      {src ? (
        // Images are stored already sized, so the host's paid optimiser is not needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="h-4/5 w-4/5 object-contain" />
      ) : (
        <span className="flex flex-col items-center gap-1 px-2 text-center text-xs text-ink-600">
          <LeafIcon size={28} />
          {small ? <span className="sr-only">Photo coming soon</span> : 'Photo coming soon'}
        </span>
      )}
    </div>
  );
}

export function availabilityText(a: Availability, sellMode: 'unit' | 'weight'): string {
  if (a.state === 'unknown') return 'Check with store';
  if (a.state === 'out') return 'Out of stock';
  if (a.state === 'low') return sellMode === 'unit' ? `Only ${Math.floor(a.available! / 1000)} left` : 'Low stock';
  return 'In stock';
}

const TONE: Record<Availability['state'], string> = { in_stock: 'text-success', low: 'text-warning', out: 'text-danger', unknown: 'text-ink-600' };

export function AvailabilityLabel({ availability, sellMode }: { availability: Availability; sellMode: 'unit' | 'weight' }) {
  return <p className={`text-xs font-medium ${TONE[availability.state]}`}>{availabilityText(availability, sellMode)}</p>;
}

export function ProductCard({ product }: { product: ShopProduct }) {
  return (
    <article className="flex h-full flex-col">
      <Link href={`/products/${product.id}`} className="block rounded-card focus-visible:outline-2 focus-visible:outline-brand-700">
        <ProductImage src={product.imageUrl} alt={product.name} />
        <h3 className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 font-medium">{product.name}</h3>
      </Link>
      <p className="mt-1 text-base font-bold">
        {formatMoney(product.priceIncl)}
        <span className="text-xs font-normal text-ink-600"> / {product.unit}</span>
      </p>
      <AvailabilityLabel availability={product.availability} sellMode={product.sellMode} />
      <div className="mt-auto pt-2">
        <AddToCart productId={product.id} sellMode={product.sellMode} unit={product.unit} availability={product.availability} compact />
      </div>
    </article>
  );
}

export function ProductRows({ products }: { products: ShopProduct[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} />
        </li>
      ))}
    </ul>
  );
}
