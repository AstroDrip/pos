import { DeviceOrderList } from '@/components/DeviceOrderList';
import { PageHeader } from '@/components/shop-parts';

export default function Orders() {
  return (
    <>
      <PageHeader title="Your orders" back="/" />
      <DeviceOrderList />
    </>
  );
}
