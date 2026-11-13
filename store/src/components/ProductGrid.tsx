'use client';

import { useState } from 'react';
import type { ShopProduct } from '@/server/catalog-core';
import { ProductRows } from './ProductCard';
import { Button } from './ui';

/** The first page comes from the server. Load more asks for the next one. */
export function ProductGrid({ initial, total, query }: { initial: ShopProduct[]; total: number; query: string }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch(`/api/store/products?${query}&offset=${items.length}`);
      if (!r.ok) throw new Error('failed');
      const data = (await r.json()) as { items: ShopProduct[] };
      setItems((now) => [...now, ...data.items]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ProductRows products={items} />
      {items.length < total && (
        <div className="mt-8 text-center">
          {failed && <p role="alert" className="mb-2 text-sm text-danger">We could not load more. Please try again.</p>}
          <Button type="button" variant="secondary" onClick={more} disabled={busy}>{busy ? 'Loading' : 'Load more'}</Button>
        </div>
      )}
    </>
  );
}
