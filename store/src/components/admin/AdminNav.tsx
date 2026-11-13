'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const LINKS = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/stock', label: 'Stock' },
];

export function AdminNav({ canProducts, canStock }: { canProducts: boolean; canStock: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {LINKS.filter((l) => (canProducts || l.href !== '/admin/products') && (canStock || l.href !== '/admin/stock')).map((l) => {
        const active = l.exact ? path === l.href : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold ${active ? 'border-leaf-500 text-white' : 'border-transparent text-white/80 hover:text-white'}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Keeps a staff page current without a permanent connection. Pauses while the tab is hidden. */
export function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
