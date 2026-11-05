import { describe, expect, it } from 'vitest';
import { ENTER_GUARD_MS, decideKey, incrementQtyText, parseStepQty, type KeyContext, type KeyInfo } from './checkout-keys';

const key = (k: string, o: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, ctrl: false, repeat: false, msSinceStepChange: 10_000, ...o });
const ctx = (o: Partial<KeyContext> = {}): KeyContext => ({ step: 'search', field: 'search', searchEmpty: true, billHasItems: true, splitCardTyped: false, busy: false, ...o });
const act = (k: KeyInfo, c: KeyContext) => decideKey(k, c).type;

describe('checkout key state machine (ADR-2)', () => {
  it('search: Enter on an empty box opens payment only when the bill has items', () => {
    expect(act(key('Enter'), ctx())).toBe('openPay');
    expect(act(key('Enter'), ctx({ billHasItems: false }))).toBe('swallow');
    expect(act(key('Enter'), ctx({ searchEmpty: false }))).toBe('none'); // SearchBox handles typed text
    expect(act(key('Enter'), ctx({ busy: true }))).toBe('swallow');
  });

  it('search: + on an empty box adds one to the last line; with text it is ordinary typing', () => {
    expect(act(key('+'), ctx())).toBe('incLast');
    expect(act(key('+'), ctx({ searchEmpty: false }))).toBe('none');
    expect(act(key('a'), ctx())).toBe('none');
  });

  it('qty: + increments, Enter confirms, Esc cancels, digits type normally', () => {
    const q = ctx({ step: 'qty', field: 'qty' });
    expect(act(key('+'), q)).toBe('qtyInc');
    expect(act(key('Enter'), q)).toBe('qtyConfirm');
    expect(act(key('Escape'), q)).toBe('toSearch');
    expect(act(key('5'), q)).toBe('none');
    expect(act(key('Backspace'), q)).toBe('none');
  });

  it('pay: Enter in cash pays cash, Ctrl+Enter pays card, Esc goes back', () => {
    const p = ctx({ step: 'pay', field: 'cash' });
    expect(act(key('Enter'), p)).toBe('payCash');
    expect(act(key('Enter', { ctrl: true }), p)).toBe('payCard');
    expect(act(key('Escape'), p)).toBe('toSearch');
  });

  it('pay: during a split, Enter in the card part never pays and Ctrl+Enter is refused', () => {
    const p = ctx({ step: 'pay', field: 'cardPart', splitCardTyped: true });
    expect(act(key('Enter'), p)).toBe('focusCash');
    expect(decideKey(key('Enter', { ctrl: true }), p)).toEqual({ type: 'refuse', reason: 'split' });
    expect(act(key('Enter'), ctx({ step: 'pay', field: 'other' }))).toBe('none'); // e.g. supervisor PIN box
  });

  it('guards: held or double-tapped Enter cannot run through to a sale', () => {
    expect(act(key('Enter', { repeat: true }), ctx({ step: 'pay', field: 'cash' }))).toBe('swallow');
    expect(act(key('Enter', { msSinceStepChange: ENTER_GUARD_MS - 1 }), ctx({ step: 'pay', field: 'cash' }))).toBe('swallow');
    expect(act(key('Enter', { msSinceStepChange: ENTER_GUARD_MS - 1 }), ctx())).toBe('swallow');
    expect(act(key('Enter', { msSinceStepChange: 50 }), ctx({ step: 'qty', field: 'qty' }))).toBe('qtyConfirm'); // fast confirm only adds the chosen item
    expect(act(key('Enter'), ctx({ step: 'pay', field: 'cash', busy: true }))).toBe('swallow');
    expect(act(key('+', { repeat: true }), ctx())).toBe('swallow');
  });

  it('quantity validation respects the product unit', () => {
    expect(parseStepQty('1', 'unit')).toEqual({ qty: 1000 });
    expect(parseStepQty(' 12 ', 'unit')).toEqual({ qty: 12_000 });
    expect(parseStepQty('1.5', 'unit')).toEqual({ error: 'This item is sold by whole units' });
    expect(parseStepQty('1.250', 'weight')).toEqual({ qty: 1250 });
    expect(parseStepQty('0', 'unit')).toEqual({ error: 'Quantity must be more than zero' });
    expect(parseStepQty('abc', 'unit')).toEqual({ error: 'Quantity must be a number' });
    expect(parseStepQty('-1', 'unit')).toEqual({ error: 'Quantity must be a number' });
    expect(parseStepQty('', 'unit')).toEqual({ error: 'Quantity must be a number' });
    expect(incrementQtyText('1')).toBe('2');
    expect(incrementQtyText('')).toBe('1');
    expect(incrementQtyText('9999')).toBe('9999');
  });
});
