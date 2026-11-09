import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBOS, resolveBindings } from '../core/shortcuts';
import { HELP_ARTICLES } from './help/content';
import { ARABIC_KEYS } from './i18n';
import { decideKey, type KeyContext } from './checkout-keys';
import {
  CONTEXT_HELP, DIRECT_SHORTCUTS, QUICK_ACTIONS, actionsFor, canonicalize, checkoutActive, commandLetter, decideGlobal, filterActions, lineQtyKey, moveHighlight, paletteKey,
  type GlobalEnv, type KeyLike, type ScreenState,
} from './keyboard-registry';

const k = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, code: '', ctrl: false, shift: false, alt: false, meta: false, composing: false, repeat: false, ...o });
const env = (o: Partial<GlobalEnv> = {}): GlobalEnv => ({ context: 'sell', paletteOpen: false, modalOpen: false, focus: 'search', step: 'search', busy: false, ...o });
const act = (key: KeyLike, e: Partial<GlobalEnv> = {}) => decideGlobal(key, env(e)).type;
const all = () => true;

describe('shortcut registry', () => {
  it('every shortcut has all the required fields', () => {
    for (const s of DIRECT_SHORTCUTS) {
      expect(s.id, s.id).toBeTruthy();
      expect(s.combo, s.id).toBeTruthy();
      expect(s.action, s.id).toBeTruthy();
      expect(s.contexts.length, s.id).toBeGreaterThan(0);
      expect(s.permission === null || typeof s.permission === 'string', s.id).toBe(true);
      expect(s.priority, s.id).toBeGreaterThan(0);
      expect(s.allowedStates.length, s.id).toBeGreaterThan(0);
      expect(['ui', 'focus', 'open-workflow', 'operation'], s.id).toContain(s.effect);
      expect(s.conflict, s.id).toBeTruthy();
      expect(s.help, s.id).toBeTruthy();
    }
  });

  it('every Quick Action has its priority, states, conflict rule and help text', () => {
    for (const a of QUICK_ACTIONS) {
      expect(a.priority, a.id).toBeGreaterThan(0);
      expect(a.allowedStates.length, a.id).toBeGreaterThan(0);
      expect(a.conflict, a.id).toBeTruthy();
      expect(a.help, a.id).toBeTruthy();
      expect(Object.keys(a.where).length, a.id).toBeGreaterThan(0);
    }
  });

  it('shortcut ids and key combinations are unique', () => {
    expect(new Set(DIRECT_SHORTCUTS.map((s) => s.id)).size).toBe(DIRECT_SHORTCUTS.length);
    expect(new Set(DIRECT_SHORTCUTS.map((s) => s.combo)).size).toBe(DIRECT_SHORTCUTS.length);
  });

  it('lists the required shortcuts and letters', () => {
    expect(DIRECT_SHORTCUTS.map((s) => s.combo).sort()).toEqual(['+', '-', 'Ctrl+Enter', 'Ctrl+F', 'Ctrl+K', 'Enter', 'Esc', 'F1', 'F4', 'Shift+Enter', 'Z'].sort());
    expect(QUICK_ACTIONS.map((a) => a.id).sort()).toEqual(['C', 'H', 'I', 'M', 'P', 'R', 'S']);
  });

  it('collections and settlements only ever open a workflow', () => {
    expect(QUICK_ACTIONS.find((a) => a.id === 'M')!.effect).toBe('open-workflow');
    expect(QUICK_ACTIONS.filter((a) => a.effect === 'operation').map((a) => a.id).sort()).toEqual(['H', 'R']);
  });

  it('every help link goes to a guide that exists', () => {
    const ids = new Set(HELP_ARTICLES.map((a) => a.id));
    for (const [c, id] of Object.entries(CONTEXT_HELP)) expect(ids.has(id), c).toBe(true);
  });

  it('every label has an Arabic translation', () => {
    const labels = QUICK_ACTIONS.flatMap((a) => [a.label, ...Object.values(a.where).map((w) => w.label).filter((l): l is string => !!l)]);
    expect(labels.filter((l) => !ARABIC_KEYS.includes(l))).toEqual([]);
  });

  it('every function name in Admin has an Arabic translation', () => {
    expect(DIRECT_SHORTCUTS.map((s) => s.action).filter((l) => !ARABIC_KEYS.includes(l))).toEqual([]);
  });

  it('the Help keyboard guides show every shortcut and every letter', () => {
    const text = HELP_ARTICLES.filter((a) => a.id === 'start-keys' || a.id === 'start-quick-actions').flatMap((a) => a.steps).join('\n');
    for (const s of DIRECT_SHORTCUTS) expect(text, s.combo).toContain(s.combo);
    for (const a of QUICK_ACTIONS) expect(text, a.id).toContain(`${a.id}:`);
    expect(text).toContain('Ctrl+K');
  });
});

describe('global keys', () => {
  it('opens help, palette and search, and leaves other keys alone', () => {
    expect(act(k('F1'))).toBe('help');
    expect(act(k('k', { ctrl: true }))).toBe('palette');
    expect(act(k('f', { ctrl: true }))).toBe('focusSearch');
    expect(act(k('F4'))).toBe('focusQty');
    expect(act(k('a'))).toBe('none');
    expect(act(k('p'))).toBe('none');
  });

  it('normal editing keys are never touched', () => {
    for (const c of ['a', 'c', 'v', 'x', 'z', 'y']) expect(act(k(c, { ctrl: true }), { focus: 'text' })).toBe('none');
    expect(act(k('F4', { alt: true }))).toBe('none'); // Alt+F4 closes the window
    expect(act(k('k', { ctrl: true, shift: true }))).toBe('none');
    expect(act(k('k', { ctrl: true, alt: true }))).toBe('none'); // AltGr on Windows
  });

  it('works on an Arabic keyboard layout', () => {
    expect(act(k('ن', { ctrl: true, code: 'KeyK' }))).toBe('palette');
    expect(act(k('ب', { ctrl: true, code: 'KeyF' }))).toBe('focusSearch');
  });

  it('never acts during IME composition', () => {
    for (const key of [k('F1', { composing: true }), k('k', { ctrl: true, composing: true })]) expect(act(key)).toBe('none');
  });

  it('a held key does nothing more', () => {
    expect(act(k('k', { ctrl: true, repeat: true }))).toBe('swallow');
    expect(act(k('F1', { repeat: true }))).toBe('swallow');
  });

  it('password boxes are left alone', () => {
    for (const key of [k('k', { ctrl: true }), k('f', { ctrl: true }), k('F1'), k('F4')]) expect(act(key, { focus: 'password' })).toBe('swallow');
  });

  it('Ctrl+F does not steal focus from work in progress', () => {
    expect(act(k('f', { ctrl: true }), { focus: 'textarea' })).toBe('swallow');
    expect(act(k('f', { ctrl: true }), { focus: 'text' })).toBe('swallow');
    expect(act(k('f', { ctrl: true }), { focus: 'select' })).toBe('swallow');
    expect(act(k('f', { ctrl: true }), { focus: 'emptyText' })).toBe('focusSearch');
    expect(act(k('f', { ctrl: true }), { focus: 'none' })).toBe('focusSearch');
  });

  it('on Sell the quantity step and payment step are protected', () => {
    expect(act(k('k', { ctrl: true }), { step: 'qty', focus: 'text' })).toBe('refuse');
    expect(act(k('F1'), { step: 'qty', focus: 'text' })).toBe('refuse');
    expect(act(k('f', { ctrl: true }), { step: 'qty', focus: 'text' })).toBe('refuse');
    expect(act(k('f', { ctrl: true }), { step: 'pay', focus: 'emptyText' })).toBe('refuse');
    expect(act(k('F4'), { step: 'pay', focus: 'emptyText' })).toBe('refuse');
    expect(act(k('F4'), { step: 'qty', focus: 'text' })).toBe('focusQty');
    expect(act(k('k', { ctrl: true }), { step: 'pay', focus: 'emptyText' })).toBe('palette');
  });

  it('nothing opens while a sale is saving', () => {
    expect(act(k('k', { ctrl: true }), { busy: true })).toBe('swallow');
    expect(act(k('F1'), { busy: true })).toBe('swallow');
    expect(act(k('F4'), { busy: true })).toBe('swallow');
  });

  it('F4 only exists on Sell', () => {
    expect(act(k('F4'), { context: 'stock', step: undefined })).toBe('none');
  });

  it('with a modal open nothing overlaps it; Esc closes it; Ctrl+F stays inside it', () => {
    expect(act(k('k', { ctrl: true }), { modalOpen: true })).toBe('swallow');
    expect(act(k('F1'), { modalOpen: true })).toBe('swallow');
    expect(act(k('F4'), { modalOpen: true })).toBe('swallow');
    expect(act(k('Escape'), { modalOpen: true })).toBe('closeModal');
    expect(act(k('f', { ctrl: true }), { modalOpen: true, step: 'pay' })).toBe('focusSearch');
  });

  it('with the palette open only Ctrl+K acts here; Esc belongs to the palette', () => {
    expect(act(k('k', { ctrl: true }), { paletteOpen: true })).toBe('closePalette');
    expect(act(k('Escape'), { paletteOpen: true })).toBe('none');
    expect(act(k('F1'), { paletteOpen: true })).toBe('swallow');
    expect(act(k('f', { ctrl: true }), { paletteOpen: true })).toBe('swallow');
  });

  it('Esc clears a suggestion box, and is otherwise left to the screen', () => {
    expect(act(k('Escape'), { focus: 'suggestWithText' })).toBe('clearSuggest');
    expect(act(k('Escape'), { focus: 'search' })).toBe('none');
    expect(act(k('Escape'), { focus: 'text' })).toBe('none');
  });
});

describe('checkout priority stays with the state machine', () => {
  const c = (o: Partial<KeyContext>): KeyContext => ({ step: 'search', field: 'search', searchEmpty: true, billHasItems: true, splitCardTyped: false, busy: false, ...o });
  const info = (key: string, o = {}) => ({ key, ctrl: false, shift: false, composing: false, repeat: false, msSinceStepChange: 10_000, ...o });

  it('the central handler ignores the payment keys, so they can never fire twice', () => {
    for (const key of [k('Enter'), k('Enter', { ctrl: true }), k('Enter', { shift: true }), k('+'), k('-')]) {
      for (const step of ['search', 'qty', 'pay'] as const) expect(act(key, { step })).toBe('none');
    }
  });

  it('cash, card and go-to-payment still work only in the right step', () => {
    expect(decideKey(info('Enter'), c({ step: 'pay', field: 'cash' })).type).toBe('payCash');
    expect(decideKey(info('Enter', { ctrl: true }), c({ step: 'pay', field: 'cash' })).type).toBe('payCard');
    expect(decideKey(info('Enter', { shift: true }), c({})).type).toBe('openPay');
    expect(decideKey(info('Enter', { shift: true }), c({ step: 'pay', field: 'cash' })).type).toBe('swallow');
    expect(decideKey(info('Enter'), c({ billHasItems: false })).type).toBe('swallow');
    expect(decideKey(info('Enter'), c({ searchEmpty: false })).type).toBe('none'); // the suggestion list goes first
    expect(decideKey(info('Enter'), c({ step: 'qty', field: 'qty' })).type).toBe('qtyConfirm'); // quantity goes first
  });
});

describe('palette letters', () => {
  it('reads the letter from the key, or the physical key on an Arabic layout', () => {
    expect(commandLetter(k('p'))).toBe('P');
    expect(commandLetter(k('P', { shift: true }))).toBe('P');
    expect(commandLetter(k('ح', { code: 'KeyP' }))).toBe('P');
    expect(commandLetter(k('p', { ctrl: true }))).toBeNull();
    expect(commandLetter(k('p', { alt: true }))).toBeNull();
    expect(commandLetter(k('5', { code: 'Digit5' }))).toBeNull();
    expect(commandLetter(k('Enter', { code: 'Enter' }))).toBeNull();
  });
});

describe('actions shown', () => {
  const state = (o: Partial<ScreenState> = {}): ScreenState => ({ unavailable: {}, ...o });
  const ids = (ctx: Parameters<typeof actionsFor>[0], can: (p: string) => boolean = all, s = state()) => actionsFor(ctx, s, can).map((a) => a.id);

  const on = (ctx: Parameters<typeof actionsFor>[0], id: string, can: (p: string) => boolean = all) => actionsFor(ctx, state(), can).find((a) => a.id === id);

  it('every screen shows all seven letters', () => {
    for (const ctx of ['sell', 'refund', 'customers', 'stock', 'products', 'purchases', 'expenses', 'accounting', 'reports', 'shift', 'admin', 'help'] as const) {
      expect(ids(ctx).sort(), ctx).toEqual(['C', 'H', 'I', 'M', 'P', 'R', 'S']);
    }
  });

  it('a letter that belongs to this screen stays on this screen', () => {
    expect(on('sell', 'P')!.goTo).toBeUndefined();
    expect(on('purchases', 'S')!.goTo).toBeUndefined();
    expect(on('customers', 'M')!.goTo).toBeUndefined();
    expect(on('stock', 'I')!.goTo).toBeUndefined();
  });

  it('item information works on the spot on every screen', () => {
    expect(on('accounting', 'I')).toMatchObject({ enabled: true });
    expect(on('accounting', 'I')!.goTo).toBeUndefined();
  });

  it('a letter from another screen says where it will go', () => {
    expect(on('accounting', 'P')!.goTo).toBe('sell');
    expect(on('accounting', 'C')!.goTo).toBe('customers');
    expect(on('accounting', 'S')!.goTo).toBe('purchases');
    expect(on('accounting', 'R')!.goTo).toBe('sell');
    expect(on('accounting', 'M')).toMatchObject({ goTo: 'customers', label: 'Customer collection' });
    expect(on('sell', 'S')!.goTo).toBe('purchases');
  });

  it('holding is grey away from Sell, because no bill is open there', () => {
    expect(on('stock', 'H')).toMatchObject({ enabled: false, reason: 'The bill is empty.' });
  });

  it('a reason from the screen also greys a letter that would leave it', () => {
    const s = actionsFor('sell', state({ unavailable: { S: 'Finish or hold the current bill first.' } }), all).find((a) => a.id === 'S')!;
    expect(s).toMatchObject({ enabled: false, reason: 'Finish or hold the current bill first.', goTo: 'purchases' });
  });

  it('goes only to a screen the user may open', () => {
    const noCustomers = (p: string) => p !== 'customer.payment.record';
    expect(on('reports', 'C', noCustomers)!.goTo).toBe('sell');
    expect(on('reports', 'M', noCustomers)).toMatchObject({ goTo: 'purchases', label: 'Supplier settlement' });
    expect(on('reports', 'M', (p) => p === 'purchase.pay')).toBeUndefined();
    expect(on('reports', 'S', (p) => p !== 'purchase.view')).toBeUndefined();
    const cashier = () => false;
    expect(ids('refund', cashier).sort()).toEqual(['C', 'H', 'I', 'P', 'R']);
  });

  it('hides what the user is not allowed to do', () => {
    expect(ids('sell', (p) => p !== 'customer.payment.record')).not.toContain('M');
    expect(ids('purchases', (p) => p !== 'purchase.pay')).not.toContain('M');
    expect(ids('purchases', (p) => p !== 'purchase.manage')).not.toContain('P');
    expect(ids('purchases', (p) => p !== 'purchase.view')).not.toContain('S');
  });

  it('shows an unavailable action as disabled with its reason', () => {
    const a = actionsFor('sell', state({ unavailable: { H: 'The bill is empty.' } }), all).find((x) => x.id === 'H')!;
    expect(a.enabled).toBe(false);
    expect(a.reason).toBe('The bill is empty.');
  });

  it('searches by name in either language', () => {
    const list = actionsFor('sell', state(), all);
    const tr = (s: string) => (s === 'Hold current order' ? 'تعليق' : s);
    expect(filterActions(list, 'hold', tr).map((a) => a.id)).toEqual(['H']);
    expect(filterActions(list, 'تعل', tr).map((a) => a.id)).toEqual(['H']);
    expect(filterActions(list, 'zzz', tr)).toEqual([]);
    expect(filterActions(list, '', tr)).toEqual(list);
  });

  it('the highlight skips disabled rows and stops at the ends', () => {
    const rows = [{ enabled: true }, { enabled: false }, { enabled: true }];
    expect(moveHighlight(rows, 0, 'ArrowDown')).toBe(2);
    expect(moveHighlight(rows, 2, 'ArrowDown')).toBe(2);
    expect(moveHighlight(rows, 2, 'ArrowUp')).toBe(0);
    expect(moveHighlight([{ enabled: false }], 0, 'ArrowDown')).toBe(-1);
  });
});

describe('palette key handling', () => {
  const list = actionsFor('sell', { unavailable: { H: 'The bill is empty.' } }, all);
  const v = (o = {}) => ({ view: 'actions' as const, query: '', searching: false, actions: list, ...o });

  it('a letter runs its action; a disabled one is refused', () => {
    expect(paletteKey(k('p'), v())).toEqual({ type: 'run', id: 'P' });
    expect(paletteKey(k('h'), v())).toEqual({ type: 'refuse', id: 'H' });
  });

  it('a letter with no action starts a search', () => {
    expect(paletteKey(k('z'), v())).toEqual({ type: 'none' });
    expect(paletteKey(k('s'), v())).toEqual({ type: 'run', id: 'S' }); // every letter is offered on every screen
  });

  it('letters are plain typing once a search has started', () => {
    expect(paletteKey(k('p'), v({ query: 'x' }))).toEqual({ type: 'none' });
    expect(paletteKey(k('p'), v({ searching: true }))).toEqual({ type: 'none' });
    expect(paletteKey(k('p'), v({ view: 'list' }))).toEqual({ type: 'none' });
  });

  it('Tab or / switches to searching by name', () => {
    expect(paletteKey(k('Tab'), v())).toEqual({ type: 'startSearch' });
    expect(paletteKey(k('/'), v())).toEqual({ type: 'startSearch' });
    expect(paletteKey(k('/'), v({ query: 'x' }))).toEqual({ type: 'none' });
  });

  it('arrows, Enter and Esc', () => {
    expect(paletteKey(k('ArrowDown'), v())).toEqual({ type: 'move', dir: 'ArrowDown' });
    expect(paletteKey(k('ArrowUp'), v())).toEqual({ type: 'move', dir: 'ArrowUp' });
    expect(paletteKey(k('Enter'), v())).toEqual({ type: 'enter' });
    expect(paletteKey(k('Escape'), v())).toEqual({ type: 'close' });
  });

  it('IME composition, and held keys that could run twice, do nothing', () => {
    expect(paletteKey(k('p', { composing: true }), v())).toEqual({ type: 'none' });
    expect(paletteKey(k('Enter', { composing: true }), v())).toEqual({ type: 'none' });
    expect(paletteKey(k('p', { repeat: true }), v())).toEqual({ type: 'swallow' });
    expect(paletteKey(k('Enter', { repeat: true }), v())).toEqual({ type: 'swallow' });
  });

  it('Ctrl+letter is not a command', () => {
    expect(paletteKey(k('a', { ctrl: true }), v())).toEqual({ type: 'none' });
    expect(paletteKey(k('p', { ctrl: true }), v())).toEqual({ type: 'none' });
  });
});

describe('changed keys', () => {
  const b = resolveBindings({ 'palette.open': 'F6', 'pay.cash': 'F9', 'pay.card': 'F10', 'checkout.open': 'F7', 'qty.inc': 'Alt+1', escape: 'F8', 'help.open': 'F2', 'letter.H': 'B' });
  const pay = checkoutActive('cash');
  const c = (key: KeyLike, active = pay) => canonicalize(key, b, active);

  it('registry defaults are the shared defaults', () => {
    for (const s of DIRECT_SHORTCUTS.filter((x) => !x.fixed)) expect(s.combo, s.id).toBe(DEFAULT_COMBOS[s.id as keyof typeof DEFAULT_COMBOS]);
  });

  it('the new central key works and the old one no longer does', () => {
    expect(decideGlobal(k('F6'), env(), b).type).toBe('palette');
    expect(decideGlobal(k('k', { ctrl: true }), env(), b).type).toBe('none');
    expect(decideGlobal(k('F2'), env(), b).type).toBe('help');
    expect(decideGlobal(k('F1'), env(), b).type).toBe('none');
  });

  it('a moved key still obeys every guard', () => {
    expect(decideGlobal(k('F6', { repeat: true }), env(), b).type).toBe('swallow');
    expect(decideGlobal(k('F6'), env({ step: 'qty', focus: 'text' }), b).type).toBe('refuse');
    expect(decideGlobal(k('F6'), env({ focus: 'password' }), b).type).toBe('swallow');
    expect(decideGlobal(k('F6', { composing: true }), env(), b).type).toBe('none');
  });

  it('a moved payment key pays through the same state machine', () => {
    const cash = { step: 'pay' as const, field: 'cash' as const, searchEmpty: true, billHasItems: true, splitCardTyped: false, busy: false };
    const run = (key: KeyLike, o: Partial<typeof cash> = {}) => {
      const x = c(key);
      return decideKey({ key: x.key, ctrl: x.ctrl, shift: x.shift, composing: x.composing, repeat: x.repeat, msSinceStepChange: 10_000 }, { ...cash, ...o }).type;
    };
    expect(run(k('F9'))).toBe('payCash');
    expect(run(k('F10'))).toBe('payCard');
    expect(run(k('Enter'))).toBe('none'); // Enter no longer pays
    expect(run(k('Enter', { ctrl: true }))).toBe('none');
    expect(run(k('F9', { repeat: true }))).toBe('swallow');
    expect(run(k('F9'), { busy: true })).toBe('swallow');
  });

  it('a moved key only applies in its own box', () => {
    expect(c(k('F9'), checkoutActive('qty')).key).toBe('F9');
    expect(c(k('Enter'), checkoutActive('qty')).key).toBe('Enter'); // Enter still confirms a quantity
    expect(c(k('Enter'), checkoutActive('cardPart')).key).toBe('Enter'); // and still moves on from the card part
    expect(c(k('Enter'), checkoutActive('search')).key).toBe('Enter'); // and still picks a suggestion
  });

  it('Alt+Enter never counts as Enter', () => {
    for (const bindings of [resolveBindings({}), b]) {
      expect(canonicalize(k('Enter', { alt: true }), bindings, pay).key).toBe('Unidentified');
      expect(canonicalize(k('Enter', { alt: true, ctrl: true }), bindings, pay).key).toBe('Unidentified');
    }
  });

  it('Alt+Enter chosen for going to payment does not pay in the cash box', () => {
    const moved = resolveBindings({ 'checkout.open': 'Alt+Enter' });
    expect(canonicalize(k('Enter', { alt: true }), moved, checkoutActive('search'))).toMatchObject({ key: 'Enter', shift: true, alt: false });
    expect(canonicalize(k('Enter', { alt: true }), moved, checkoutActive('cash')).key).toBe('Unidentified');
  });

  it('the Arabic key that types two characters still works as its letter', () => {
    expect(commandLetter(k('لا', { code: 'KeyB' }))).toBe('B');
  });

  it('nothing changed: keys pass straight through', () => {
    const d = resolveBindings({});
    expect(canonicalize(k('Enter'), d, pay)).toEqual(k('Enter'));
    expect(canonicalize(k('a'), d, pay)).toEqual(k('a'));
  });

  it('a changed letter runs the action; the old letter no longer does', () => {
    const list = actionsFor('sell', { unavailable: {} }, all, b.letters);
    const v = { view: 'actions' as const, query: '', searching: false, actions: list };
    expect(paletteKey(k('b'), v)).toEqual({ type: 'run', id: 'H' });
    expect(paletteKey(k('h'), v)).toEqual({ type: 'none' });
    expect(list.find((a) => a.id === 'H')!.letter).toBe('B');
  });
});

describe('keys in a bill line quantity box', () => {
  it('+ and − change it, Enter and Esc finish', () => {
    expect(lineQtyKey(k('+'))).toBe('inc');
    expect(lineQtyKey(k('-'))).toBe('dec');
    expect(lineQtyKey(k('Enter'))).toBe('done');
    expect(lineQtyKey(k('Escape'))).toBe('cancel');
    expect(lineQtyKey(k('5'))).toBe('none');
  });
  it('held keys and IME do not repeat the change', () => {
    expect(lineQtyKey(k('+', { repeat: true }))).toBe('swallow');
    expect(lineQtyKey(k('+', { composing: true }))).toBe('none');
    expect(lineQtyKey(k('Enter', { ctrl: true }))).toBe('none');
  });
});

describe('registry fields', () => {
  it('every shortcut says if it is enabled and where focus must be', () => {
    for (const s of DIRECT_SHORTCUTS) {
      expect(typeof s.enabled, s.id).toBe('boolean');
      expect(Array.isArray(s.focus), s.id).toBe(true);
    }
  });
  it('Z is a fixed key for holding on the payment step', () => {
    expect(DIRECT_SHORTCUTS.find((s) => s.id === 'hold.pay')).toMatchObject({ combo: 'Z', fixed: true, owner: 'checkout', contexts: ['sell'] });
  });
});
