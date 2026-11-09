// The one list of keyboard shortcuts. Pure data and pure decisions, unit-tested in keyboard-registry.test.ts.
//
// Who handles what:
//  - 'hub'      = the single window listener in Keyboard.tsx (F1, F4, Ctrl+F, Ctrl+K, Esc for popups).
//  - 'checkout' = the state machine in checkout-keys.ts, on the search, quantity and payment boxes. decideGlobal
//                 never touches those keys, so a payment key cannot be handled twice.
//  - 'palette'  = the Quick Actions box. Its letters exist only while the box is open.

import { DEFAULT_BINDINGS, DEFAULT_COMBOS, comboOf, type Bindings, type LetterId, type ShortcutId } from '../core/shortcuts';
import type { CheckoutStep } from './checkout-keys';

export type ScreenContext = 'sell' | 'refund' | 'customers' | 'stock' | 'products' | 'purchases' | 'expenses' | 'accounting' | 'reports' | 'shift' | 'admin' | 'help';
export type Effect = 'ui' | 'focus' | 'open-workflow' | 'operation';

const EVERY: ScreenContext[] = ['sell', 'refund', 'customers', 'stock', 'products', 'purchases', 'expenses', 'accounting', 'reports', 'shift', 'admin', 'help'];

export interface Shortcut {
  id: string;
  /** False would keep a shortcut in the list but switch it off. */
  enabled: boolean;
  /** The kind of box focus must be in for it to work. */
  focus: string[];
  /** True when the admin cannot move it to another key. */
  fixed?: boolean;
  combo: string;
  action: string;
  contexts: ScreenContext[];
  permission: string | null;
  /** Higher wins when two owners could take the same key. */
  priority: number;
  allowedStates: string[];
  effect: Effect;
  owner: 'hub' | 'checkout';
  conflict: string;
  /** Plain English, shown in the Help Centre. */
  help: string;
}

export const DIRECT_SHORTCUTS: Shortcut[] = [
  { id: 'help.open', enabled: true, focus: ['anywhere except a PIN box'], combo: 'F1', action: 'Open the Help Centre', contexts: EVERY, permission: null, priority: 50, allowedStates: ['no popup open', 'not saving', 'not on the quantity step'], effect: 'ui', owner: 'hub', conflict: 'Refused on the quantity step so the chosen item is not lost.', help: 'opens help for the screen you are on, over the screen. Your bill stays. Esc goes back.' },
  { id: 'qty.focus', enabled: true, focus: ['search box','quantity box','no box'], combo: 'F4', action: 'Go to the quantity box', contexts: ['sell'], permission: null, priority: 50, allowedStates: ['search step', 'quantity step'], effect: 'focus', owner: 'hub', conflict: 'Alt+F4 is never touched. Refused on the payment step.', help: 'on Sell, goes to the quantity of the last item on the bill. Type a number, or press + or −, then Enter.' },
  { id: 'customer.focus', enabled: true, focus: ['any box except a PIN box'], combo: 'F2', action: 'Go to the customer box', contexts: ['sell'], permission: null, priority: 50, allowedStates: ['search step', 'payment step'], effect: 'focus', owner: 'hub', conflict: 'Refused on the quantity step so the chosen item is not lost. From payment it steps back to the bill first.', help: 'on Sell, goes to the customer box. Your bill stays as it is.' },
  { id: 'search.focus', enabled: true, focus: ['empty box','search box','no box'], combo: 'Ctrl+F', action: "Go to the screen's main search box", contexts: EVERY, permission: null, priority: 50, allowedStates: ['not typing in another box', 'not on the quantity or payment step'], effect: 'focus', owner: 'hub', conflict: 'Does nothing while you are typing in a filled box, a note, a list or a PIN box.', help: "goes to the main search box of the screen. It will not move you while you are typing in another box." },
  { id: 'palette.open', enabled: true, focus: ['anywhere except a PIN box'], combo: 'Ctrl+K', action: 'Open Quick Actions', contexts: EVERY, permission: null, priority: 60, allowedStates: ['no popup open', 'not saving', 'not on the quantity step'], effect: 'ui', owner: 'hub', conflict: 'Pressed again, it closes Quick Actions.', help: 'opens Quick Actions. Then press one letter.' },
  { id: 'checkout.open', enabled: true, focus: ['product search box, empty'], combo: 'Shift+Enter', action: 'Finish the order and go to payment', contexts: ['sell'], permission: null, priority: 40, allowedStates: ['search step, empty box, items on the bill'], effect: 'open-workflow', owner: 'checkout', conflict: 'Refused while a search or quantity is unfinished. Does nothing on the payment step.', help: 'with the search box empty, goes to the payment step. It never takes a payment.' },
  { id: 'pay.cash', enabled: true, focus: ['Cash received box'], combo: 'Enter', action: 'Confirm cash payment', contexts: ['sell'], permission: null, priority: 30, allowedStates: ['payment step, in Cash received'], effect: 'operation', owner: 'checkout', conflict: 'A suggestion list and the quantity box use Enter first.', help: 'in Cash received on the payment step, pays cash. Elsewhere it picks the highlighted item or confirms the quantity.' },
  { id: 'pay.card', enabled: true, focus: ['Cash received box','card part box'], combo: 'Ctrl+Enter', action: 'Confirm card payment', contexts: ['sell'], permission: null, priority: 30, allowedStates: ['payment step, no split being typed'], effect: 'operation', owner: 'checkout', conflict: 'Refused while a split card part is typed.', help: 'on the payment step, records a card payment. Press it only after the bank terminal shows APPROVED.' },
  { id: 'qty.inc', enabled: true, focus: ['quantity box','bill line quantity box','product search box, empty'], combo: '+', action: 'One more of the selected item', contexts: ['sell'], permission: null, priority: 30, allowedStates: ['quantity box', 'bill line quantity box', 'empty search box'], effect: 'operation', owner: 'checkout', conflict: 'With text in the search box it is ordinary typing.', help: 'adds one in the quantity box, or to the last item when the search box is empty.' },
  { id: 'qty.dec', enabled: true, focus: ['quantity box','bill line quantity box','product search box, empty'], combo: '-', action: 'One less of the selected item', contexts: ['sell'], permission: null, priority: 30, allowedStates: ['quantity box', 'bill line quantity box', 'empty search box'], effect: 'operation', owner: 'checkout', conflict: 'With text in the search box it is ordinary typing.', help: 'takes one off in the quantity box, or from the last item when the search box is empty.' },
  { id: 'hold.pay', enabled: true, focus: ['Cash received box', 'card part box'], fixed: true, combo: 'Z', action: 'Hold the bill', contexts: ['sell'], permission: null, priority: 30, allowedStates: ['payment step, items on the bill'], effect: 'operation', owner: 'checkout', conflict: 'Any other box types Z as usual. A scanned code is never taken for this key.', help: 'on the payment step, puts the bill on hold. It is not a sale. No money is taken and no stock moves.' },
  { id: 'escape', enabled: true, focus: ['anywhere'], combo: 'Esc', action: 'Close the popup or suggestion list', contexts: EVERY, permission: null, priority: 70, allowedStates: ['always'], effect: 'ui', owner: 'hub', conflict: 'The open popup goes first, then the suggestion list, then the current checkout step.', help: 'closes a popup or a suggestion list. On Sell it also goes back one step.' },
];

export type ActionId = 'P' | 'C' | 'S' | 'H' | 'R' | 'I' | 'M';

export interface QuickAction {
  id: ActionId;
  label: string;
  priority: number;
  allowedStates: string[];
  conflict: string;
  /** Plain English, shown in the Help Centre. */
  help: string;
  effect: Effect;
  keywords: string[];
  /** Screens where it runs on the spot. Each screen can set its own permission and label. */
  where: Partial<Record<ScreenContext, { permission: string | null; label?: string }>>;
  /** From any other screen the letter opens the first of these the user may open. */
  homes?: Home[];
  /** Why it cannot be used from any other screen at all. */
  notElsewhere?: string;
}

interface Home {
  screen: ScreenContext;
  permissions: string[];
}

const EVERYWHERE = Object.fromEntries(EVERY.map((c) => [c, { permission: null }])) as Record<ScreenContext, { permission: null }>;
const SELL_HOME: Home = { screen: 'sell', permissions: [] };
const CUSTOMERS_HOME: Home = { screen: 'customers', permissions: ['customer.payment.record'] };

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'P', priority: 20, allowedStates: ['on Sell: search step only'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Goes to the product search box. On Purchases it opens Return to supplier first.", label: 'Product search', effect: 'focus', keywords: ['find', 'item', 'barcode'], where: { sell: { permission: null }, stock: { permission: null }, products: { permission: null }, purchases: { permission: 'purchase.manage' } }, homes: [SELL_HOME] },
  { id: 'C', priority: 20, allowedStates: ['on Sell: search step, no customer on the bill yet'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Goes to the customer box.", label: 'Customer search', effect: 'focus', keywords: ['find', 'phone', 'client'], where: { sell: { permission: null }, customers: { permission: null } }, homes: [CUSTOMERS_HOME, SELL_HOME] },
  { id: 'S', priority: 20, allowedStates: ['Purchases only'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Find a supplier by name and open their statement. Nothing is paid.", label: 'Supplier search', effect: 'open-workflow', keywords: ['find', 'vendor', 'statement'], where: { purchases: { permission: 'purchase.view' } }, homes: [{ screen: 'purchases', permissions: ['purchase.view'] }] },
  { id: 'H', priority: 20, allowedStates: ['Sell, search step, items on the bill'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Puts the current order on hold, like the Hold bill button.", label: 'Hold current order', effect: 'operation', keywords: ['park', 'save', 'bill', 'suspend'], where: { sell: { permission: null } }, homes: [SELL_HOME], notElsewhere: 'The bill is empty.' },
  { id: 'R', priority: 20, allowedStates: ['Sell, search step, empty bill, a held order exists'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Shows the held orders. Choose one to bring it back.", label: 'Retrieve held order', effect: 'operation', keywords: ['recall', 'bill', 'resume'], where: { sell: { permission: null } }, homes: [SELL_HOME] },
  { id: 'I', priority: 20, allowedStates: ['always where offered'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Shows the price and stock of an item. Scan it or type its name. It does not add anything to the bill.", label: 'Item information', effect: 'ui', keywords: ['price', 'stock', 'check', 'lookup'], where: EVERYWHERE },
  { id: 'M', priority: 20, allowedStates: ['on Sell: empty bill only'], conflict: 'Only while Quick Actions is open and its box is empty.', help: "Opens customer collection (Customers, Sell) or supplier settlement (Purchases). You still type the amount and press the button yourself; nothing is paid by this key.", label: 'Money', effect: 'open-workflow', keywords: ['pay', 'payment', 'collect', 'settle', 'account'], where: { sell: { permission: 'customer.payment.record', label: 'Customer collection' }, customers: { permission: 'customer.payment.record', label: 'Customer collection' }, purchases: { permission: 'purchase.pay', label: 'Supplier settlement' } }, homes: [CUSTOMERS_HOME, { screen: 'purchases', permissions: ['purchase.view', 'purchase.pay'] }] },
];

/** The guide F1 opens on each screen. */
export const CONTEXT_HELP: Record<ScreenContext, string> = {
  sell: 'start-keys', refund: 'returns-refund', customers: 'customers-find-add', stock: 'stock-overview', products: 'stock-products', purchases: 'suppliers-enter-bill',
  expenses: 'expenses-record', accounting: 'reports-owner', reports: 'reports-sales', shift: 'shifts-open', admin: 'backup-run', help: 'start-keys',
};

export interface KeyLike {
  key: string;
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  composing: boolean;
  repeat: boolean;
}

export type FocusKind = 'none' | 'search' | 'emptyText' | 'text' | 'suggestWithText' | 'textarea' | 'select' | 'password';

export interface GlobalEnv {
  context: ScreenContext;
  paletteOpen: boolean;
  modalOpen: boolean;
  focus: FocusKind;
  /** Only Sell has steps. */
  step: CheckoutStep | undefined;
  busy: boolean;
}

export type GlobalAction =
  | { type: 'none' | 'swallow' | 'help' | 'palette' | 'closePalette' | 'closeModal' | 'focusSearch' | 'focusQty' | 'focusCustomer' | 'clearSuggest' }
  | { type: 'refuse'; reason: 'qty' | 'pay' };

const NONE: GlobalAction = { type: 'none' };
const SWALLOW: GlobalAction = { type: 'swallow' };

/** Which central function this key press is, with the keys the admin chose. */
function which(k: KeyLike, b: Bindings): 'help' | 'qty' | 'customer' | 'search' | 'palette' | 'escape' | null {
  const combo = comboOf(k);
  if (!combo) return null;
  if (combo === b.direct['help.open']) return 'help';
  if (combo === b.direct['qty.focus']) return 'qty';
  if (combo === b.direct['customer.focus']) return 'customer';
  if (combo === b.direct.escape) return 'escape';
  if (combo === b.direct['search.focus']) return 'search';
  if (combo === b.direct['palette.open']) return 'palette';
  return null;
}

const CANONICAL: Partial<Record<ShortcutId, { key: string; ctrl?: boolean; shift?: boolean }>> = {
  'pay.cash': { key: 'Enter' },
  'pay.card': { key: 'Enter', ctrl: true },
  'checkout.open': { key: 'Enter', shift: true },
  'qty.inc': { key: '+' },
  'qty.dec': { key: '-' },
  escape: { key: 'Escape' },
};

/**
 * Turns a key press into the key the checkout rules know, using the admin's choices. All guards (held keys, the
 * Enter timer, the busy lock) then work unchanged. A default key whose function moved away stops doing that function.
 */
export function canonicalize(k: KeyLike, b: Bindings, active: readonly ShortcutId[]): KeyLike {
  const combo = comboOf(k);
  for (const id of active) {
    if (combo === b.direct[id]) return { ...k, key: CANONICAL[id]!.key, ctrl: !!CANONICAL[id]!.ctrl, shift: !!CANONICAL[id]!.shift, alt: false, meta: false };
  }
  for (const id of active) {
    if (combo === DEFAULT_COMBOS[id] && b.direct[id] !== DEFAULT_COMBOS[id]) return { ...k, key: 'Unidentified', code: '' };
  }
  return k.alt ? { ...k, key: 'Unidentified', code: '' } : k; // the checkout rules have no Alt: Alt+Enter must not act as Enter
}

/** The changeable checkout functions that apply in each box. */
export function checkoutActive(field: 'search' | 'customer' | 'qty' | 'cash' | 'cardPart' | 'other'): readonly ShortcutId[] {
  switch (field) {
    case 'customer': return ['checkout.open'];
    case 'search': return ['checkout.open', 'qty.inc', 'qty.dec'];
    case 'qty': return ['qty.inc', 'qty.dec', 'escape'];
    case 'cash': return ['pay.cash', 'pay.card', 'escape'];
    case 'cardPart': return ['pay.card', 'escape'];
    case 'other': return [];
  }
}

/** What the central listener does with a key. Every key it does not know is left completely alone. */
export function decideGlobal(k: KeyLike, e: GlobalEnv, b: Bindings = DEFAULT_BINDINGS): GlobalAction {
  if (k.composing) return NONE;
  const w = which(k, b);
  if (!w) return NONE;
  if ((w === 'qty' || w === 'customer') && e.context !== 'sell' && !e.paletteOpen && !e.modalOpen) return NONE;

  if (e.paletteOpen) {
    if (w === 'escape') return NONE; // the palette closes itself, or closes its list first
    if (w === 'palette' && !k.repeat) return { type: 'closePalette' };
    return SWALLOW;
  }
  if (w === 'escape') {
    if (k.repeat) return NONE;
    if (e.modalOpen) return { type: 'closeModal' };
    return e.focus === 'suggestWithText' ? { type: 'clearSuggest' } : NONE;
  }
  if (k.repeat || e.focus === 'password' || e.busy) return SWALLOW;
  if (e.modalOpen) return w === 'search' ? { type: 'focusSearch' } : SWALLOW; // never a second popup on top of one

  if (w === 'qty') return e.step === 'pay' ? { type: 'refuse', reason: 'pay' } : { type: 'focusQty' };
  if (e.step === 'qty') return { type: 'refuse', reason: 'qty' };
  if (w === 'customer') return { type: 'focusCustomer' };
  if (w === 'help') return { type: 'help' };
  if (w === 'palette') return { type: 'palette' };
  // Ctrl+F
  if (e.step === 'pay') return { type: 'refuse', reason: 'pay' };
  if (e.focus === 'textarea' || e.focus === 'text' || e.focus === 'select') return SWALLOW;
  return { type: 'focusSearch' };
}

/** The palette letter for a key: the typed Latin letter, or the physical key on another layout such as Arabic. */
export function commandLetter(k: KeyLike): string | null {
  if (k.ctrl || k.meta || k.alt) return null;
  if (/^[a-zA-Z]$/.test(k.key)) return k.key.toUpperCase();
  if (!/[^ -~]/.test(k.key)) return null; // plain ASCII that is not a letter: digits, Enter, Tab…
  const m = /^Key([A-Z])$/.exec(k.code);
  return m ? m[1]! : null; // another layout: some Arabic keys type two characters
}

export interface ScreenState {
  /** Action id -> why it cannot run right now (an English phrase for t()). */
  unavailable: Partial<Record<ActionId, string>>;
}

export interface ShownAction {
  id: ActionId;
  /** The key that runs it: the admin may have changed it. */
  letter: string;
  label: string;
  keywords: string[];
  effect: Effect;
  enabled: boolean;
  reason?: string;
  /** Set when the letter belongs to another screen: choosing it opens that screen. */
  goTo?: ScreenContext;
}

/** What Quick Actions shows: every letter the user may use, from any screen. Not allowed = hidden; allowed but not possible now = shown disabled. */
export function actionsFor(context: ScreenContext, state: ScreenState, can: (permission: string) => boolean, letters: Record<LetterId, string> = DEFAULT_BINDINGS.letters): ShownAction[] {
  return QUICK_ACTIONS.flatMap((a) => {
    const shown = { id: a.id, letter: letters[a.id], keywords: a.keywords, effect: a.effect };
    const w = a.where[context];
    if (w) {
      if (w.permission && !can(w.permission)) return [];
      const reason = state.unavailable[a.id];
      return [{ ...shown, label: w.label ?? a.label, enabled: !reason, reason }];
    }
    const home = a.homes?.find((h) => h.permissions.every(can));
    if (!home) return [];
    const reason = a.notElsewhere ?? state.unavailable[a.id];
    return [{ ...shown, label: a.where[home.screen]?.label ?? a.label, enabled: !reason, reason, goTo: home.screen }];
  });
}

export function filterActions(list: ShownAction[], query: string, translate: (s: string) => string): ShownAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((a) => [a.label, translate(a.label), ...a.keywords].some((s) => s.toLowerCase().includes(q)));
}

/** Arrow keys in the palette: skip disabled rows, stop at the ends; -1 when nothing can be chosen. */
export function moveHighlight(rows: readonly { enabled: boolean }[], current: number, dir: 'ArrowDown' | 'ArrowUp'): number {
  const step = dir === 'ArrowDown' ? 1 : -1;
  for (let i = current + step; i >= 0 && i < rows.length; i += step) if (rows[i]!.enabled) return i;
  return rows[current]?.enabled ? current : rows.findIndex((r) => r.enabled);
}

export type PaletteAction =
  | { type: 'none' | 'swallow' | 'enter' | 'close' | 'startSearch' }
  | { type: 'run' | 'refuse'; id: ActionId }
  | { type: 'move'; dir: 'ArrowDown' | 'ArrowUp' };

export interface PaletteView {
  view: 'actions' | 'list' | 'item';
  query: string;
  /** The cashier chose to search by name, so letters are typing. */
  searching: boolean;
  actions: ShownAction[];
}

/** One key inside the palette. Letters are commands only on the first screen, with an empty box. */
export function paletteKey(k: KeyLike, v: PaletteView): PaletteAction {
  if (k.composing) return { type: 'none' };
  if (k.key === 'ArrowDown' || k.key === 'ArrowUp') return { type: 'move', dir: k.key };
  if (k.key === 'Escape') return { type: 'close' };
  if (k.key === 'Enter') return k.repeat ? { type: 'swallow' } : { type: 'enter' };
  const commands = v.view === 'actions' && !v.query && !v.searching;
  if (commands && (k.key === 'Tab' || k.key === '/')) return { type: 'startSearch' };
  if (k.key === 'Tab') return { type: 'swallow' }; // focus stays inside the palette
  if (!commands) return { type: 'none' };
  const letter = commandLetter(k);
  const a = letter ? v.actions.find((x) => x.letter === letter) : undefined;
  if (!a) return { type: 'none' };
  if (k.repeat) return { type: 'swallow' };
  return { type: a.enabled ? 'run' : 'refuse', id: a.id };
}

export type LineQtyAction = 'none' | 'swallow' | 'inc' | 'dec' | 'done' | 'cancel';

/** One key in a bill line's quantity box. */
export function lineQtyKey(k: KeyLike): LineQtyAction {
  if (k.composing || k.ctrl || k.meta || k.alt) return 'none';
  const known = k.key === '+' || k.key === '-' || k.key === 'Enter' || k.key === 'Escape';
  if (!known) return 'none';
  if (k.repeat) return 'swallow';
  return k.key === '+' ? 'inc' : k.key === '-' ? 'dec' : k.key === 'Enter' ? (k.shift ? 'none' : 'done') : 'cancel';
}

/** Reads the fields the decisions need from a browser or React key event. */
export function keyLike(e: KeyboardEvent): KeyLike {
  return { key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, composing: e.isComposing, repeat: e.repeat };
}
