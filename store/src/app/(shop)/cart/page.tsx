import { CartView } from '@/components/CartView';
import { FulfilmentPicker } from '@/components/FulfilmentPicker';
import { PageHeader } from '@/components/shop-parts';
import { listDeliveryAreas } from '@/server/catalog-core';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const areas = await listDeliveryAreas(shopDb());
  return (
    <>
      <PageHeader title="Your cart" back="/" />
      <div className="mb-3 lg:hidden"><FulfilmentPicker areas={areas} /></div>
      <CartView />
    </>
  );
}
