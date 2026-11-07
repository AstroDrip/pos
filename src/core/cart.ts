/**
 * Bill (cart) quantity changes before payment. Pure functions: they return a new list and never touch money;
 * totals still come only from computeInvoice (core/vat.ts).
 * Quantities are milli-units. Weighed lines come from scale labels: the label is the weight, so these
 * functions never change them (owner decision Q-8: typing a weight is not approved).
 */
import { extendPrice, roundDiv } from './money';

export interface CartLine<P extends { id: number; sellMode: 'unit' | 'weight'; priceIncl: number }> {
  product: P;
  qty: number;
  discount: number; // halalas
  scanCode?: string;
}
type Item = { id: number; sellMode: 'unit' | 'weight'; priceIncl: number };
export interface Removed<P extends Item> { line: CartLine<P>; index: number }

const UNIT = 1000;
export const MAX_UNITS = 9999;

const isUnit = <P extends Item>(l: CartLine<P> | undefined): l is CartLine<P> => !!l && l.product.sellMode === 'unit';
/** The line's amount incl. VAT after its discount (never below 0). */
const lineAmount = <P extends Item>(l: CartLine<P>) => Math.max(0, extendPrice(l.product.priceIncl, l.qty) - l.discount);
const discountFits = <P extends Item>(l: CartLine<P>, qty: number) => extendPrice(l.product.priceIncl, qty) >= l.discount;

export type QtyChange<P extends Item> = { lines: CartLine<P>[]; removed: Removed<P> | null; blocked?: 'discount' };

/**
 * What leaves the bill when a line goes down to `newQty` (0 = removed), for the removal log: the quantity and its
 * share of the line amount. null when the quantity does not go down.
 */
export function reductionOf<P extends Item>(line: CartLine<P>, newQty: number): { productId: number; qty: number; amount: number } | null {
  if (newQty >= line.qty) return null;
  const qty = line.qty - Math.max(0, newQty);
  return { productId: line.product.id, qty, amount: roundDiv(lineAmount(line) * qty, line.qty) };
}

export function incrementLine<P extends Item>(lines: CartLine<P>[], idx: number): CartLine<P>[] {
  const l = lines[idx];
  if (!isUnit(l)) return lines;
  return lines.map((x, k) => (k === idx ? { ...x, qty: Math.min(x.qty + UNIT, MAX_UNITS * UNIT) } : x));
}

/** One fewer. On the last unit the line is removed and returned, so it can be logged and put back (Undo). */
export function decrementLine<P extends Item>(lines: CartLine<P>[], idx: number): QtyChange<P> {
  const l = lines[idx];
  if (!isUnit(l)) return { lines, removed: null };
  if (l.qty <= UNIT) return { lines: lines.filter((_, k) => k !== idx), removed: { line: l, index: idx } };
  if (!discountFits(l, l.qty - UNIT)) return { lines, removed: null, blocked: 'discount' };
  return { lines: lines.map((x, k) => (k === idx ? { ...x, qty: x.qty - UNIT } : x)), removed: null };
}

/** A typed whole number of units; 0 removes the line (returned for logging and Undo). */
export function setLineQty<P extends Item>(lines: CartLine<P>[], idx: number, wholeUnits: number): QtyChange<P> {
  const l = lines[idx];
  if (!isUnit(l) || !Number.isInteger(wholeUnits) || wholeUnits < 0) return { lines, removed: null };
  if (wholeUnits === 0) return { lines: lines.filter((_, k) => k !== idx), removed: { line: l, index: idx } };
  const qty = Math.min(wholeUnits, MAX_UNITS) * UNIT;
  if (!discountFits(l, qty)) return { lines, removed: null, blocked: 'discount' };
  return { lines: lines.map((x, k) => (k === idx ? { ...x, qty } : x)), removed: null };
}

/** Undo a removal: the same line (product, quantity, discount) back at its old place, or at the end. */
export function restoreLine<P extends Item>(lines: CartLine<P>[], removed: Removed<P>): CartLine<P>[] {
  const at = Math.min(removed.index, lines.length);
  return [...lines.slice(0, at), removed.line, ...lines.slice(at)];
}
