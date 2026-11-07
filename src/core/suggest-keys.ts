/** Shared suggestion-list rules for every search box (POS, product pickers, customers, help). */

/** Ask for suggestions from the first character, but never for blank text or while an IME is still composing. */
export function shouldQuery(text: string, composing: boolean): boolean {
  return !composing && text.trim().length > 0;
}

/** Arrow keys in a suggestion list: move one step, stop at the first and last item; -1 when the list is empty. */
export function moveActive(active: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  return key === 'ArrowDown' ? Math.min(active + 1, count - 1) : Math.max(active - 1, 0);
}
