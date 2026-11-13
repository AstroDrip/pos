import Link from 'next/link';
import type { ReactNode } from 'react';
import { FulfilmentPicker } from '@/components/FulfilmentPicker';
import { SearchBox } from '@/components/SearchBox';
import { BottomNav, TopLinks } from '@/components/ShopNav';
import { listDeliveryAreas } from '@/server/catalog-core';
import { readEnv } from '@/server/env';
import { shopDb } from '@/server/routes';

export const dynamic = 'force-dynamic';

export default async function ShopLayout({ children }: { children: ReactNode }) {
  const areas = await listDeliveryAreas(shopDb());
  return (
    <div className="min-h-dvh pb-24 lg:pb-12">
      <header className="sticky top-0 z-20 hidden border-b border-line bg-surface lg:block">
        <div className="mx-auto flex max-w-shop items-center gap-5 px-4 py-3">
          <Link href="/" className="inline-flex min-h-11 shrink-0 items-center text-lg font-bold text-brand-900">{readEnv().displayName}</Link>
          <FulfilmentPicker areas={areas} />
          <div className="min-w-0 flex-1"><SearchBox /></div>
          <TopLinks />
        </div>
      </header>
      <main className="mx-auto max-w-shop px-4">{children}</main>
      <BottomNav />
    </div>
  );
}
