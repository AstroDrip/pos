import { useRef, useState } from 'react';
import { formatSar } from '../core/money';
import { moveActive } from '../core/suggest-keys';
import type { Product } from '../services/catalog';
import type { SearchHit } from '../services/search';
import { call } from './api';
import { useI18n } from './i18n';
import { useSuggest } from './useSuggest';

const DEBOUNCE_MS = 150;

/**
 * Product search for the cashier: suggestions from the first character (codes and names), ranked by match and then
 * by how often customers buy each product; 150 ms pause, ↑/↓ to move, Enter to pick (or to look up the typed code when nothing is highlighted), Esc to close.
 * Slow, older answers never replace newer ones, and nothing is searched while an Arabic IME is composing.
 */
export function SearchBox({
  onPick,
  onCode,
  disabled,
  inputRef,
  onEmptyKey,
  onFocusBox,
}: {
  onPick: (p: Product) => void;
  onCode: (code: string) => void;
  disabled?: boolean;
  /** Lets the checkout put focus back here after each step. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Keys pressed while the box is empty (Enter = payment, + = one more), see checkout-keys.ts. Return true if handled. */
  onEmptyKey?: (e: React.KeyboardEvent<HTMLInputElement>) => boolean;
  onFocusBox?: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);
  const navigated = useRef(false); // the cashier moved the highlight with the arrow keys
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;

  const { items: hits, loading, cancel } = useSuggest<SearchHit>(text, (q) => call<SearchHit[]>('catalog.suggest', { text: q }), {
    debounceMs: DEBOUNCE_MS,
    composing,
    onResults: (r) => {
      setActive(r.length ? 0 : -1);
      setOpen(true);
    },
  });

  const reset = (refocus = true) => {
    cancel();
    navigated.current = false;
    setText('');
    setOpen(false);
    setActive(-1);
    if (refocus) input.current?.focus();
  };
  const pick = (h: SearchHit) => {
    reset(false); // the checkout moves focus to the quantity step
    onPick(h.product);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (!text.trim() && onEmptyKey?.(e)) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) {
      e.preventDefault();
      if (e.key === 'ArrowDown') setOpen(true);
      navigated.current = true;
      const key = e.key;
      setActive((a) => moveActive(a, hits.length, key));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = text.trim();
      if (!q) return;
      // Digits (barcodes, PLUs, scale labels) always use the exact lookup, never a "similar" suggestion.
      // Text picks the highlighted suggestion; the cashier sees it highlighted before pressing Enter.
      const chosen = hits[active];
      if (chosen && open && (navigated.current || !/^\d+$/.test(q))) {
        pick(chosen);
      } else {
        onCode(q);
        reset();
      }
    }
  };

  return (
    <div className="searchbox">
      <label>{t('Scan, or type barcode / PLU / SKU and press Enter')}</label>
      <input
        ref={input}
        autoFocus
        aria-label="product search"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          navigated.current = false;
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          setText(e.currentTarget.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => {
          onFocusBox?.();
          if (hits.length) setOpen(true);
        }}
      />
      {open && text.trim() && (
        <ul className="suggestions" role="listbox">
          {hits.length === 0 && !loading && <li className="none">{t('No matching products')}</li>}
          {hits.map((h, i) => (
            <li
              key={h.product.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>
                {lang === 'ar' ? h.product.nameAr : h.product.nameEn}
                <small className="ar"> {lang === 'ar' ? h.product.nameEn : h.product.nameAr} · {h.product.sku}</small>
              </span>
              <span className="num">
                {formatSar(h.product.priceIncl)}
                {h.product.sellMode === 'weight' ? ` /${t('kg')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {loading && <div className="ar">{t('Searching…')}</div>}
    </div>
  );
}
