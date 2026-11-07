/**
 * Bill (cart) quantity changes before payment. Pure functions: they return a new list and never touch money;
 * totals still come only from computeInvoice (core/vat.ts).
 * Quantities are milli-units. Weighed lines come from scale labels: the label is the weight, so these
 * functions never change them (owner decision Q-8: typing a weight is not approved).
 */
export interface CartLine<P extends { id: number; sellMode: 'unit' | 'weight' }> {
  product: P;
  qty: number;
  discount: number; // halalas
  scanCode?: string;
}
type Item = { id: number; sellMode: 'unit' | 'weight' };
export interface Removed<P extends Item> { line: CartLine<P>; index: number }

const UNIT = 1000;
export const MAX_UNITS = 9999;

const isUnit = <P extends Item>(l: CartLine<P> | undefined): l is CartLine<P> => !!l && l.product.sellMode === 'unit';

export function incrementLine<P extends Item>(lines: CartLine<P>[], idx: number): CartLine<P>[] {
  const l = lines[idx];
  if (!isUnit(l)) return lines;
  return lines.map((x, k) => (k === idx ? { ...x, qty: Math.min(x.qty + UNIT, MAX_UNITS * UNIT) } : x));
}

/** One fewer. On the last unit the line is removed and returned, so it can be logged and put back (Undo). */
export function decrementLine<P extends Item>(lines: CartLine<P>[], idx: number): { lines: CartLine<P>[]; removed: Removed<P> | null } {
  const l = lines[idx];
  if (!isUnit(l)) return { lines, removed: null };
  if (l.qty <= UNIT) return { lines: lines.filter((_, k) => k !== idx), removed: { line: l, index: idx } };
  return { lines: lines.map((x, k) => (k === idx ? { ...x, qty: x.qty - UNIT } : x)), removed: null };
}

/** A typed whole number of units; 0 removes the line (returned for logging and Undo). */
export function setLineQty<P extends Item>(lines: CartLine<P>[], idx: number, wholeUnits: number): { lines: CartLine<P>[]; removed: Removed<P> | null } {
  const l = lines[idx];
  if (!isUnit(l) || !Number.isInteger(wholeUnits) || wholeUnits < 0) return { lines, removed: null };
  if (wholeUnits === 0) return { lines: lines.filter((_, k) => k !== idx), removed: { line: l, index: idx } };
  const qty = Math.min(wholeUnits, MAX_UNITS) * UNIT;
  return { lines: lines.map((x, k) => (k === idx ? { ...x, qty } : x)), removed: null };
}

/** Undo a removal: the same line (product, quantity, discount) back at its old place, or at the end. */
export function restoreLine<P extends Item>(lines: CartLine<P>[], removed: Removed<P>): CartLine<P>[] {
  const at = Math.min(removed.index, lines.length);
  return [...lines.slice(0, at), removed.line, ...lines.slice(at)];
}
