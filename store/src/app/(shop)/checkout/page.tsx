import { CheckoutView } from '@/components/CheckoutView';
import { PageHeader } from '@/components/shop-parts';
import { listDeliveryAreas } from '@/server/catalog-core';
import { checkoutMethods } from '@/server/order-core';
import { shopDb } from '@/server/routes';
import { getSettings } from '@/server/settings-core';

export const dynamic = 'force-dynamic';

export default async function Checkout() {
  const db = shopDb();
  const [areas, settings] = await Promise.all([listDeliveryAreas(db), getSettings(db)]);
  return (
    <>
      <PageHeader title="Checkout" back="/cart" />
      <CheckoutView areas={areas} pickupMethods={checkoutMethods(settings.paymentMethods, 'pickup')} deliveryMethods={checkoutMethods(settings.paymentMethods, 'delivery')} />
    </>
  );
}
