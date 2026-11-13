import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { OrderView } from '@/components/OrderView';
import { PageHeader } from '@/components/shop-parts';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(ref)) notFound();
  return (
    <>
      <PageHeader title={`Order ${ref}`} back="/orders" />
      <Suspense><OrderView publicRef={ref} /></Suspense>
    </>
  );
}
