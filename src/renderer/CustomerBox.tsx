import { useRef, useState } from 'react';
import { customerEnter, moveActive } from '../core/suggest-keys';
import type { Customer } from '../services/parties';
import { call } from './api';
import { useI18n } from './i18n';
import { useSuggest } from './useSuggest';

/**
 * The customer box on Sell. Suggestions appear from the first character. Nothing is chosen until the cashier
 * highlights a row and presses Enter, or clicks one: a single match is never picked by itself.
 */
export function CustomerBox({ canCreate, onPick, onKey, onFocusBox, onLeave, onError }: {
  canCreate: boolean;
  onPick: (c: Customer) => void;
  /** Checkout keys for this box. Returns true when the key was used. */
  onKey: (e: React.KeyboardEvent<HTMLInputElement>, empty: boolean) => boolean;
  onFocusBox: () => void;
  /** Esc with no list open: back to product search. */
  onLeave: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const composing = useRef(false);
  const { items, itemsFor, loading, cancel } = useSuggest<Customer>(text, (q) => call<Customer[]>('customer.find', { text: q }), {
    composing,
    onResults: () => {
      setActive(-1); // nothing is highlighted until the cashier moves to it
      setOpen(true);
    },
  });

  const clear = () => {
    cancel();
    setText('');
    setOpen(false);
    setActive(-1);
  };
  const pick = (c: Customer) => {
    clear();
    onPick(c);
  };
  const startAdding = () => {
    const typed = text.trim();
    const isPhone = /^\+?[\d\s-]+$/.test(typed);
    setAdding({ name: isPhone ? '' : typed, phone: isPhone ? typed : '' });
    setOpen(false);
  };
  const saveNew = async () => {
    if (!adding || !adding.name.trim()) return;
    try {
      const name = adding.name.trim();
      const phone = adding.phone.trim() || undefined;
      const id = await call<number>('customer.create', { name, phone });
      setAdding(null);
      pick({ id, name, phone: phone ?? null, vatNumber: null });
    } catch (e) {
      onError(t((e as Error).message));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const q = text.trim();
    if (onKey(e, !q)) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      setOpen(true);
      const key = e.key;
      setActive((a) => moveActive(a, items.length, key));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open && q) setOpen(false);
      else onLeave();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = items[active];
      if (chosen && customerEnter({ text, itemsFor, loading, open, active })) pick(chosen);
    }
  };

  if (adding) {
    return (
      <div className="row" role="group" aria-label="add customer">
        <div style={{ width: '100%' }}>
          <label htmlFor="new-customer-name" style={{ marginTop: 0 }}>{t('New customer name')}</label>
          <input id="new-customer-name" autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAdding(null); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveNew(); } }} />
          <label htmlFor="new-customer-phone">{t('Phone (optional)')}</label>
          <input id="new-customer-phone" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAdding(null); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveNew(); } }} />
          <p>
            <button type="button" disabled={!adding.name.trim()} onClick={() => void saveNew()}>{t('Add customer')}</button>{' '}
            <button type="button" onClick={() => setAdding(null)}>{t('Cancel')}</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="searchbox" style={{ width: '100%' }}>
      <label htmlFor="customer-phone" style={{ marginTop: 0 }}>{t('Customer (optional)')}</label>
      <input
        id="customer-phone"
        data-kb-search="customer"
        placeholder={t('Name or phone')}
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          setText(e.currentTarget.value);
        }}
        onFocus={() => {
          onFocusBox();
          if (items.length) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && text.trim() && (
        <ul className="suggestions" role="listbox" aria-label="customer suggestions">
          {items.length === 0 && !loading && <li className="none">{t('No matching customers')}</li>}
          {items.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{c.name}</span>
              <span className="num">{c.phone}</span>
            </li>
          ))}
          {canCreate && !loading && (
            <li
              role="option"
              aria-selected={false}
              className="add-new"
              onMouseDown={(e) => {
                e.preventDefault();
                startAdding();
              }}
            >
              <span>{t('Add new customer')}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
