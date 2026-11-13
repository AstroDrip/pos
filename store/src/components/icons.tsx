import type { ReactNode } from 'react';

// Hand-drawn icons, so the shop needs no icon package.
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
type P = { size?: number };

export const HomeIcon = (p: P) => <Icon {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></Icon>;
export const GridIcon = (p: P) => <Icon {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Icon>;
export const CartIcon = (p: P) => <Icon {...p}><path d="M3 4h2.2l2.3 11h10.2l2-8H6.2" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="16.5" cy="19.5" r="1.3" /></Icon>;
export const OrdersIcon = (p: P) => <Icon {...p}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3v3h6V3" /><path d="M9 11h6M9 15h6" /></Icon>;
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Icon>;
export const PinIcon = (p: P) => <Icon {...p}><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.900 12 21 12 21Z" /><circle cx="12" cy="9.500" r="2.500" /></Icon>;
export const BackIcon = (p: P) => <Icon {...p}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const MinusIcon = (p: P) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const TrashIcon = (p: P) => <Icon {...p}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 13h10l1-13" /></Icon>;
export const CloseIcon = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const ChevronIcon = (p: P) => <Icon {...p}><path d="m7 10 5 5 5-5" /></Icon>;
export const LeafIcon = (p: P) => <Icon {...p}><path d="M5 19c0-9 5-14 15-15 0 10-5 15-14 15" /><path d="M5 19c2-5 5-8 9-10" /></Icon>;
