// Keyboard checkout state machine (ADR-2). Pure functions, unit-tested in checkout-keys.test.ts.
//
// State   Field         Key          Action
// search  (empty box)   Enter        open payment (only with items on the bill)
// search  (empty box)   +            add 1 to the last unit line added
// search  (text)        ↑ ↓ Enter Esc handled by SearchBox (suggestions / exact code lookup)
// qty     quantity      digits       edit the quantity (normal typing)
// qty     quantity      +            add 1
// qty     quantity      Enter        put the line on the bill, back to search
// qty     quantity      Esc          cancel, back to search
// pay     cash          Enter        pay cash (typed amount, or exact if blank; plus any split card part)
// pay     card part     Enter        move to the cash box (never pays: the split is still being typed)
// pay     any           Ctrl+Enter   pay the whole bill by card (refused while a split card part is typed)
// pay     any           Esc          back to search
//
// Guards: auto-repeated keys are ignored, and Enter cannot open payment or pay within ENTER_GUARD_MS of a
// step change, so a held or double-tapped Enter can never run through qty → payment → sale. The sale itself is also
// protected by the busy lock and the bill's idempotency key.

export type CheckoutStep = 'search' | 'qty' | 'pay';
export const ENTER_GUARD_MS = 350;

export interface KeyInfo {
  key: string;
  ctrl: boolean;
  repeat: boolean;
  msSinceStepChange: number;
}

export interface KeyContext {
  step: CheckoutStep;
  field: 'search' | 'qty' | 'cash' | 'cardPart' | 'other';
  searchEmpty: boolean;
  billHasItems: boolean;
  splitCardTyped: boolean;
  busy: boolean;
}

export type KeyAction =
  | { type: 'none' } // let the key do its normal thing
  | { type: 'swallow' } // stop the key, do nothing (guards)
  | { type: 'openPay' }
  | { type: 'incLast' }
  | { type: 'qtyInc' }
  | { type: 'qtyConfirm' }
  | { type: 'toSearch' }
  | { type: 'focusCash' }
  | { type: 'payCash' }
  | { type: 'payCard' }
  | { type: 'refuse'; reason: 'split' };

const NONE: KeyAction = { type: 'none' };
const SWALLOW: KeyAction = { type: 'swallow' };

export function decideKey(k: KeyInfo, c: KeyContext): KeyAction {
  const isEnter = k.key === 'Enter';
  if (k.repeat && (isEnter || k.key === '+')) return SWALLOW;
  // Enter right after a step change cannot open payment or pay. Confirming a quantity quickly is allowed:
  // it only adds the item the cashier just chose, which is the fast path.
  if (isEnter && c.step !== 'qty' && k.msSinceStepChange < ENTER_GUARD_MS) return SWALLOW;

  switch (c.step) {
    case 'search':
      if (c.field !== 'search' || !c.searchEmpty || k.ctrl) return NONE;
      if (isEnter) return c.billHasItems && !c.busy ? { type: 'openPay' } : SWALLOW;
      if (k.key === '+') return c.billHasItems ? { type: 'incLast' } : SWALLOW;
      return NONE;
    case 'qty':
      if (c.field !== 'qty') return NONE;
      if (k.key === '+') return { type: 'qtyInc' };
      if (isEnter && !k.ctrl) return { type: 'qtyConfirm' };
      if (k.key === 'Escape') return { type: 'toSearch' };
      return NONE;
    case 'pay':
      if (k.key === 'Escape') return { type: 'toSearch' };
      if (!isEnter) return NONE;
      if (c.busy) return SWALLOW;
      if (k.ctrl) return c.splitCardTyped ? { type: 'refuse', reason: 'split' } : { type: 'payCard' };
      if (c.field === 'cardPart') return { type: 'focusCash' };
      if (c.field === 'cash') return { type: 'payCash' };
      return NONE; // e.g. the supervisor PIN box: Enter does not pay from there
  }
}

/** Validates a typed quantity for the qty step. Returns milli-units or an error key for t(). */
export function parseStepQty(text: string, sellMode: 'unit' | 'weight'): { qty: number } | { error: string } {
  const m = /^\s*(\d{1,4})(?:\.(\d{1,3}))?\s*$/.exec(text);
  if (!m) return { error: 'Quantity must be a number' };
  const qty = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  if (qty <= 0) return { error: 'Quantity must be more than zero' };
  if (sellMode === 'unit' && qty % 1000 !== 0) return { error: 'This item is sold by whole units' };
  if (qty > 9_999_000) return { error: 'Quantity is too large' };
  return { qty };
}

/** "+" in the qty step: add one whole unit to what is typed (blank or invalid counts as 0). */
export function incrementQtyText(text: string): string {
  const n = /^\s*\d{1,4}\s*$/.test(text) ? Number(text) : 0;
  return String(Math.min(n + 1, 9999));
}
