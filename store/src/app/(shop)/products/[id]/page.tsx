import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '../../../../../../src/core/money';
import { AddToCart } from '@/components/AddToCart';
import { AvailabilityLabel, ProductImage } from '@/components/ProductCard';
import { PageHeader } from '@/components/shop-parts';
import { getProduct } from '@/server/catalog-core';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = /^\d{1,12}$/.test(id) ? await getProduct(shopDb(), Number(id)) : null;
  if (!product) notFound();
  return (
    <>
      <div className="lg:hidden"><PageHeader title={product.categoryName ?? 'Product'} back={product.categoryId ? `/categories/${product.categoryId}` : '/categories'} heading={false} /></div>
      <div className="grid gap-6 lg:mt-8 lg:grid-cols-2 lg:gap-12">
        <ProductImage src={product.imageUrl} alt={product.name} />
        <div className="lg:py-4">
          {product.categoryId && <Link href={`/categories/${product.categoryId}`} className="hidden min-h-6 items-center text-sm font-medium text-brand-700 hover:underline lg:inline-flex">{product.categoryName}</Link>}
          <h1 className="text-2xl leading-tight font-bold lg:mt-2 lg:text-3xl">{product.name}</h1>
          <p className="mt-3 text-2xl font-bold">{formatMoney(product.priceIncl)}<span className="text-sm font-normal text-ink-600"> / {product.unit}, VAT included</span></p>
          <div className="mt-2"><AvailabilityLabel availability={product.availability} sellMode={product.sellMode} /></div>
          {product.sellMode === 'weight' && <p className="mt-3 rounded-field bg-surface-soft p-3 text-sm text-ink-600">Sold by weight. The quantity you choose is an estimate, and the final price is set after weighing.</p>}
          {product.availability.state === 'out' && <p className="mt-3 text-sm text-ink-600">This product is out of stock, so it cannot be added right now.</p>}
          <div className="mt-5 max-w-xs"><AddToCart productId={product.id} sellMode={product.sellMode} unit={product.unit} availability={product.availability} name={product.name} /></div>
          {product.description && (
            <section className="mt-8">
              <h2 className="font-bold">About this product</h2>
              <p className="mt-1 whitespace-pre-line text-ink-600">{product.description}</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
