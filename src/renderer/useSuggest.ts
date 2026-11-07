import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { shouldQuery } from '../core/suggest-keys';

/**
 * Suggestions for a search box, shared by the POS product box, the product pickers, the customer search and Help.
 * Asks from the first character after a short pause; a slower, older answer never replaces a newer one; nothing is
 * asked while an IME (e.g. Arabic) is still composing. The data still comes from each screen's own service call.
 */
export function useSuggest<T>(
  text: string,
  fetch: (q: string) => Promise<T[]>,
  opts: { debounceMs?: number; composing?: RefObject<boolean>; onResults?: (items: T[]) => void } = {},
) {
  const [items, setItems] = useState<T[]>([]);
  const [itemsFor, setItemsFor] = useState(''); // the text the current items answer
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const latest = useRef({ fetch, onResults: opts.onResults });
  latest.current = { fetch, onResults: opts.onResults };
  const debounceMs = opts.debounceMs ?? 150;
  const composing = opts.composing;

  useEffect(() => {
    const q = text.trim();
    if (!shouldQuery(q, composing?.current ?? false)) {
      seq.current++; // cancel anything in flight
      setItems([]);
      setItemsFor('');
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      latest.current.fetch(q).then(
        (r) => {
          if (mine !== seq.current) return; // a newer search has started
          setItems(r);
          setItemsFor(q);
          setLoading(false);
          latest.current.onResults?.(r);
        },
        () => mine === seq.current && setLoading(false),
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, debounceMs, composing]);

  /** Drop the list and ignore any answer still on its way. */
  const cancel = useCallback(() => {
    seq.current++;
    setItems([]);
    setItemsFor('');
    setLoading(false);
  }, []);
  /** Ask again for the same text (e.g. after saving a change). */
  const refresh = useCallback(() => {
    const q = text.trim();
    if (!q) return;
    const mine = ++seq.current;
    void latest.current.fetch(q).then((r) => {
      if (mine !== seq.current) return;
      setItems(r);
      setItemsFor(q);
    });
  }, [text]);

  return { items, itemsFor, loading, cancel, refresh };
}
