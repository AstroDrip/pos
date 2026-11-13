'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { itemCount } from '@/domain/cart';
import { useCart } from './cart-store';
import { CartIcon, GridIcon, HomeIcon, OrdersIcon } from './icons';

const ITEMS = [
  { href: '/', label: 'Home', icon: <HomeIcon size={22} /> },
  { href: '/categories', label: 'Categories', icon: <GridIcon size={22} /> },
  { href: '/cart', label: 'Cart', icon: <CartIcon size={22} /> },
  { href: '/orders', label: 'Orders', icon: <OrdersIcon size={22} /> },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));

function Badge({ children }: { children: ReactNode }) {
  return <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-leaf-500 px-1 text-[0.6875rem] font-bold text-ink-900">{children}</span>;
}

/** The fixed bar on phones and tablets. */
export function BottomNav() {
  const path = usePathname();
  const count = itemCount(useCart());
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {ITEMS.map((i) => {
          const active = isActive(path, i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? 'page' : undefined} className="flex flex-col items-center gap-0.5 py-2 text-xs font-medium">
                <span className={`relative flex size-10 items-center justify-center rounded-nav ${active ? 'bg-brand-900 text-white' : 'text-ink-600'}`}>
                  {i.icon}
                  {i.href === '/cart' && count > 0 && <Badge>{count}</Badge>}
                </span>
                <span className={active ? 'font-semibold text-brand-900' : 'text-ink-600'}>{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The links in the top bar on laptops and larger. */
export function TopLinks() {
  const path = usePathname();
  const count = itemCount(useCart());
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {ITEMS.map((i) => {
        const active = isActive(path, i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined} className={`relative flex min-h-11 items-center gap-2 rounded-nav px-3 text-sm font-medium ${active ? 'bg-brand-900 text-white' : 'text-ink-600 hover:bg-surface-soft'}`}>
            {i.icon}
            {i.label}
            {i.href === '/cart' && count > 0 && <Badge>{count}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}
