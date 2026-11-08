import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { formatQty, formatSar } from '../core/money';
import type { ItemInfo, LookupResult } from '../services/catalog';
import type { Supplier } from '../services/parties';
import type { SearchHit } from '../services/search';
import { call } from './api';
import { useI18n } from './i18n';
import { actionsFor, filterActions, keyLike, moveHighlight, paletteKey, type ActionId, type ScreenContext } from './keyboard-registry';
import type { ScreenKeys } from './Keyboard';
import { focusWhenReady } from './Keyboard';
import { useSuggest } from './useSuggest';

/** A scanner sends the next key within a few milliseconds; a person never does. */
const LETTER_DELAY_MS = 40;

type ListId = 'I' | 'S' | 'R';
type Row = { key: string; label: string; sub?: string; letter?: string; enabled: boolean; reason?: string; value: number | ActionId };

/** Ctrl+K: a short list of what can be done on this screen. Letters work only while this box is open. */
export function QuickActions({ context, can, screen, scanTarget, onClose }: {
  context: ScreenContext;
  can: (permission: string) => boolean;
  screen: RefObject<ScreenKeys | null>;
  scanTarget: RefObject<((code: string) => boolean) | null>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<ListId | null>(null);
  const [item, setItem] = useState<ItemInfo | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);
  const snap = screen.current?.state() ?? { unavailable: {} };

  const { items: hits } = useSuggest<SearchHit>(list === 'I' ? query : '', (q) => call<SearchHit[]>('catalog.suggest', { text: q }), { composing });
  useEffect(() => {
    if (list === 'S') void call<Supplier[]>('supplier.list').then(setSuppliers, () => setSuppliers([]));
  }, [list]);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const showItem = (productId: number) => {
    void call<ItemInfo>('catalog.itemInfo', { productId }).then((i) => {
      setItem(i);
      setNote('');
      setQuery('');
    }, (e: Error) => setNote(t(e.message)));
  };
  // While Item information is open, a scan checks the item and never adds it to the bill.
  useEffect(() => {
    if (list !== 'I') return;
    scanTarget.current = (code) => {
      void call<LookupResult | null>('catalog.lookup', { code }).then((r) => {
        if (r) showItem(r.product.id);
        else setNote(t('Not found: {0}', code));
      }, (e: Error) => setNote(t(e.message)));
      return true;
    };
    return () => {
      scanTarget.current = null;
    };
  }, [list]);

  const actions = useMemo(() => actionsFor(context, snap, can), [context, can, JSON.stringify(snap.unavailable)]);
  const name = (p: { nameEn: string; nameAr: string }) => (lang === 'ar' ? p.nameAr : p.nameEn);
  const q = query.trim().toLowerCase();
  const rows: Row[] = item ? []
    : list === 'I' ? hits.map((h) => ({ key: `p${h.product.id}`, label: name(h.product), sub: `${formatSar(h.product.priceIncl)} ${t('SAR')}`, enabled: true, value: h.product.id }))
    : list === 'S' ? suppliers.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q)).slice(0, 30).map((s) => ({ key: `s${s.id}`, label: s.name, sub: s.phone ?? undefined, enabled: true, value: s.id }))
    : list === 'R' ? (snap.held ?? []).filter((h) => !q || h.label.toLowerCase().includes(q)).map((h) => ({ key: `h${h.id}`, label: h.label, enabled: true, value: h.id }))
    : filterActions(actions, query, t).map((a) => ({ key: a.id, label: t(a.label), letter: a.id, enabled: a.enabled, reason: a.reason, value: a.id }));
  const rowsKey = rows.map((r) => `${r.key}:${r.enabled}`).join();
  useEffect(() => setActive(rows.findIndex((r) => r.enabled)), [rowsKey]);

  const finish = (fn: () => void) => {
    if (done.current) return; // a repeated key can never run an action twice
    done.current = true;
    onClose(false);
    fn();
  };
  const run = (id: ActionId, arg?: number) => {
    const s = screen.current;
    if (s?.run && (context === 'sell' || context === 'purchases' || (context === 'customers' && id === 'M'))) return finish(() => s.run!(id, arg));
    finish(() => focusWhenReady(`[data-kb-search="${id === 'C' ? 'customer' : 'product'}"]`));
  };
  const choose = (id: ActionId) => {
    setNote('');
    const now = screen.current?.state().unavailable[id]; // a scan may have changed the bill since the box opened
    if (now) return setNote(t(now));
    if (id === 'I' || id === 'S' || id === 'R') {
      setList(id);
      setQuery('');
      setSearching(false);
      return;
    }
    run(id);
  };
  const enter = () => {
    if (list === 'I' && /^\d{4,}$/.test(query.trim())) return lookupCode(query.trim());
    const r = rows[active];
    if (!r?.enabled) return;
    if (list === 'I') showItem(r.value as number);
    else if (list) run(list, r.value as number);
    else choose(r.value as ActionId);
  };

  const lookupCode = (code: string) => {
    void call<LookupResult | null>('catalog.lookup', { code }).then((r) => {
      setQuery('');
      if (r) showItem(r.product.id);
      else setNote(t('Not found: {0}', code));
    }, (e: Error) => setNote(t(e.message)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (pending.current) { // a second key straight after a letter: that was a scanner, not a cashier
      clearTimeout(pending.current);
      pending.current = null;
    }
    const a = paletteKey(keyLike(e.nativeEvent), { view: item ? 'item' : list ? 'list' : 'actions', query, searching, actions });
    if (a.type === 'none') return;
    e.preventDefault();
    switch (a.type) {
      case 'run': {
        const id = a.id;
        pending.current = setTimeout(() => {
          pending.current = null;
          choose(id);
        }, LETTER_DELAY_MS);
        break;
      }
      case 'refuse': setNote(t(actions.find((x) => x.id === a.id)?.reason ?? '')); break;
      case 'move': setActive((c) => moveHighlight(rows, c, a.dir)); break;
      case 'enter': if (item) onClose(true); else enter(); break;
      case 'close': onClose(true); break;
      case 'startSearch': setSearching(true); break;
      case 'swallow': break;
    }
  };

  const placeholder = list === 'I' ? t('Scan, or type the item name') : list === 'S' ? t('Type the supplier name') : list === 'R' ? t('Choose the held order') : searching ? t('Type what you want to do') : t('Press a letter');
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(true)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('Quick Actions')} onMouseDown={(e) => e.target !== input.current && e.preventDefault()}>
        <h3>{list === 'I' ? t('Item information') : list === 'S' ? t('Supplier search') : list === 'R' ? t('Retrieve held order') : t('Quick Actions')}</h3>
        <input
          ref={input}
          autoFocus
          aria-label="quick actions search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setItem(null);
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false;
            setQuery(e.currentTarget.value);
          }}
        />
        {item ? (
          <dl className="palette-item" aria-label="item information">
            <div><dt>{t('Item')}</dt><dd>{name(item)}</dd></div>
            <div><dt>{t('SKU')}</dt><dd>{item.sku}</dd></div>
            <div><dt>{t('Price')}</dt><dd className="num">{formatSar(item.priceIncl)} {t('SAR')}{item.sellMode === 'weight' ? ` /${t('kg')}` : ''}</dd></div>
            <div><dt>{t('In stock')}</dt><dd className="num">{formatQty(item.stockQty, item.sellMode === 'weight' ? 3 : 0)}</dd></div>
          </dl>
        ) : rows.length === 0 ? (
          <p className="none">{actions.length === 0 && !list ? t('No quick actions on this screen.') : t('Nothing found.')}</p>
        ) : (
          <ul role="listbox" aria-label="quick actions">
            {rows.map((r, i) => (
              <li
                key={r.key}
                role="option"
                aria-selected={i === active}
                aria-disabled={!r.enabled}
                className={`${i === active ? 'active' : ''}${r.enabled ? '' : ' off'}`}
                onMouseEnter={() => r.enabled && setActive(i)}
                onClick={() => {
                  if (!r.enabled) return setNote(t(r.reason ?? ''));
                  if (list === 'I') showItem(r.value as number);
                  else if (list) run(list, r.value as number);
                  else choose(r.value as ActionId);
                }}
              >
                {r.letter && <span className="kbd" dir="ltr">{r.letter}</span>}
                <span className="grow">{r.label}</span>
                {r.sub && <small className="num">{r.sub}</small>}
                {r.reason && <small>{t(r.reason)}</small>}
              </li>
            ))}
          </ul>
        )}
        {note && <p className="msg warn" role="status">{note}</p>}
        <small className="hint">{list || item ? t('↑ ↓ and Enter to choose · Esc to close') : t('Press a letter · ↑ ↓ and Enter · Tab to search by name · Esc to close')}</small>
      </div>
    </div>
  );
}
