'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Overview', d: 'M4 11l8-7 8 7v9h-5v-5H9v5H4z' },
  { href: '/sales', label: 'Sales', d: 'M5 20V10m7 10V4m7 16v-7' },
  { href: '/profit', label: 'Profit', d: 'M12 3v18m4-14.5C15 5.5 13.6 5 12 5c-2.5 0-4.5 1.2-4.5 3.3 0 4.7 9 2.5 9 7.4 0 2.1-2 3.3-4.5 3.3-1.8 0-3.3-.6-4.5-1.7' },
  { href: '/stock', label: 'Stock', d: 'M3 8l9-5 9 5v8l-9 5-9-5zm0 0l9 5 9-5m-9 5v8' },
  { href: '/more', label: 'More', d: 'M4 7h16M4 12h16M4 17h16' },
];
const MORE = ['/more', '/credit', '/sync'];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((i) => {
        const on = i.href === '/more' ? MORE.includes(path) : path === i.href;
        return (
          <Link key={i.href} href={i.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={i.d} /></svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
