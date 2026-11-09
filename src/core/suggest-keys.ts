/** Shared suggestion-list rules for every search box (POS, product pickers, customers, help). */

/** Ask for suggestions from the first character, but never for blank text or while an IME is still composing. */
export function shouldQuery(text: string, composing: boolean): boolean {
  return !composing && text.trim().length > 0;
}

/** The one item a list holds, only if the list answers exactly this text. Otherwise the user must choose. */
export function singleMatch<T>(items: readonly T[], itemsFor: string, text: string): T | null {
  return items.length === 1 && itemsFor === text ? items[0]! : null;
}

/** Arrow keys in a suggestion list: move one step, stop at the first and last item; -1 when the list is empty. */
export function moveActive(active: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  return key === 'ArrowDown' ? Math.min(active + 1, count - 1) : Math.max(active - 1, 0);
}

/**
 * Enter in a product search box: pick the highlighted suggestion, or look up the typed text as an exact code.
 * A suggestion is picked only when the list belongs to exactly the text in the box and no answer is pending, so a
 * code typed or scanned quickly after a letter is never swapped for an older suggestion. Codes (digits, or letters
 * with digits) use the exact lookup unless the cashier moved the highlight with the arrow keys.
 */
export function enterAction(s: { text: string; itemsFor: string; loading: boolean; open: boolean; hasActive: boolean; navigated: boolean }): 'pick' | 'code' {
  const q = s.text.trim();
  if (!s.open || !s.hasActive || s.loading || s.itemsFor !== q) return 'code';
  const codeLike = /\d/.test(q) && /^[0-9A-Za-z-]+$/.test(q);
  return codeLike && !s.navigated ? 'code' : 'pick';
}

/** Enter in a customer box: only a row the cashier highlighted, from the list that answers exactly this text. */
export function customerEnter(s: { text: string; itemsFor: string; loading: boolean; open: boolean; active: number }): boolean {
  return s.open && s.active >= 0 && !s.loading && s.itemsFor === s.text.trim();
}
