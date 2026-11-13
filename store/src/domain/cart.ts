// The cart a shopper builds on their own device. It holds only ids and quantities: prices always come from the server.

export type SellMode = 'unit' | 'weight';

export interface CartItem {
  productId: number;
  qty: number;
}

export interface CartState {
  items: CartItem[];
  fulfilment: 'delivery' | 'pickup';
  areaId: string | null;
}

export const EMPTY_CART: CartState = { items: [], fulfilment: 'delivery', areaId: null };

export const stepFor = (mode: SellMode): number => (mode === 'weight' ? 500 : 1000);

export function setQty(cart: CartState, productId: number, qty: number): CartState {
  const others = cart.items.filter((i) => i.productId !== productId);
  if (qty <= 0) return { ...cart, items: others };
  const exists = others.length !== cart.items.length;
  return { ...cart, items: exists ? cart.items.map((i) => (i.productId === productId ? { productId, qty } : i)) : [...cart.items, { productId, qty }] };
}

export function addItem(cart: CartState, productId: number, qty: number): CartState {
  return setQty(cart, productId, (cart.items.find((i) => i.productId === productId)?.qty ?? 0) + qty);
}

export const itemCount = (cart: CartState): number => cart.items.length;

export const qtyLabel = (qty: number, mode: SellMode, unit: string): string => (mode === 'weight' ? `About ${qty / 1000} ${unit}` : String(qty / 1000));

const goodItem = (i: unknown): i is CartItem => {
  const x = i as CartItem;
  return typeof x === 'object' && x !== null && Number.isSafeInteger(x.productId) && x.productId > 0 && Number.isSafeInteger(x.qty) && x.qty > 0;
};

/** Saved data can be old or damaged. Anything doubtful becomes an empty cart. */
export function parseCart(raw: string | null): CartState {
  if (!raw) return EMPTY_CART;
  try {
    const v = JSON.parse(raw) as Partial<CartState>;
    if (!Array.isArray(v.items) || !v.items.every(goodItem)) return EMPTY_CART;
    if (v.fulfilment !== 'delivery' && v.fulfilment !== 'pickup') return EMPTY_CART;
    return { items: v.items, fulfilment: v.fulfilment, areaId: typeof v.areaId === 'string' ? v.areaId : null };
  } catch {
    return EMPTY_CART;
  }
}
