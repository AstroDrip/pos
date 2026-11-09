/** Plain line icons for the sidebar. They support the labels and are never the only way to tell tabs apart. */
const PATHS: Record<string, string> = {
  sell: 'M4 5h2l2 11h10l2-8H7m2 12h.01M17 20h.01',
  refund: 'M9 7L5 11l4 4M5 11h10a4 4 0 0 1 0 8h-3',
  customers: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6m1-16a3.5 3.5 0 0 1 0 7m2 3c2 .8 3 2.900 3 6',
  shift: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  products: 'M4 7l8-4 8 4v10l-8 4-8-4V7zm0 0l8 4 8-4m-8 4v10',
  stock: 'M4 20V10m6 10V5m6 15v-7m4 7H3',
  purchases: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  expenses: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6',
  accounting: 'M4 21V4h16v17M8 8h8M8 12h2m4 0h2m-8 4h2m4 0h2',
  reports: 'M4 19l5-6 4 3 7-9',
  audit: 'M12 3l8 3v6c0 4.500-3.300 7.800-8 9-4.700-1.200-8-4.500-8-9V6l8-3zm-3 9l2 2 4-4',
  admin: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  help: 'M9.500 9a2.500 2.500 0 1 1 3.800 2.100c-.8.5-1.300 1-1.300 1.900m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  collapse: 'M4 6h16M4 12h16M4 18h16',
};

export function NavIcon({ name }: { name: string }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name] ?? ''} /></svg>;
}
