import { describe, expect, it } from 'vitest';
import { ENTER_GUARD_MS, decideKey, decrementQtyText, incrementQtyText, parseStepQty, type KeyContext, type KeyInfo } from './checkout-keys';

const key = (k: string, o: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, ctrl: false, shift: false, composing: false, repeat: false, msSinceStepChange: 10_000, ...o });
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

  it('search: - on an empty box takes one off the last line; with text it is ordinary typing', () => {
    expect(act(key('-'), ctx())).toBe('decLast');
    expect(act(key('-'), ctx({ billHasItems: false }))).toBe('swallow');
    expect(act(key('-'), ctx({ searchEmpty: false }))).toBe('none');
    expect(act(key('-', { repeat: true }), ctx())).toBe('swallow');
  });

  it('qty: - takes one off what is typed', () => {
    expect(act(key('-'), ctx({ step: 'qty', field: 'qty' }))).toBe('qtyDec');
    expect(decrementQtyText('5')).toBe('4');
    expect(decrementQtyText('1')).toBe('1');
    expect(decrementQtyText('')).toBe('1');
    expect(decrementQtyText('abc')).toBe('1');
  });

  const shiftEnter = (o: Partial<KeyInfo> = {}) => key('Enter', { shift: true, ...o });

  it('Shift+Enter on an empty search box goes to payment, with the same guards as Enter', () => {
    expect(act(shiftEnter(), ctx())).toBe('openPay');
    expect(act(shiftEnter(), ctx({ billHasItems: false }))).toBe('swallow');
    expect(act(shiftEnter(), ctx({ busy: true }))).toBe('swallow');
    expect(act(shiftEnter({ msSinceStepChange: ENTER_GUARD_MS - 1 }), ctx())).toBe('swallow');
    expect(act(shiftEnter({ repeat: true }), ctx())).toBe('swallow');
  });

  it('Shift+Enter is refused while a search or a quantity is unfinished', () => {
    expect(decideKey(shiftEnter(), ctx({ searchEmpty: false }))).toEqual({ type: 'refuse', reason: 'pendingSearch' });
    expect(decideKey(shiftEnter(), ctx({ step: 'qty', field: 'qty' }))).toEqual({ type: 'refuse', reason: 'pendingQty' });
  });

  it('Shift+Enter never pays', () => {
    for (const field of ['cash', 'cardPart', 'other'] as const) {
      for (const repeat of [false, true]) {
        for (const splitCardTyped of [false, true]) {
          const a = act(shiftEnter({ repeat }), ctx({ step: 'pay', field, splitCardTyped }));
          expect(a).not.toBe('payCash');
          expect(a).not.toBe('payCard');
          expect(a).toBe('swallow');
        }
      }
    }
    expect(act(shiftEnter({ ctrl: true }), ctx({ step: 'pay', field: 'cash' }))).toBe('swallow');
  });

  it('Shift+Enter in other fields (PIN, discount) does nothing special', () => {
    expect(act(shiftEnter(), ctx({ field: 'other' }))).toBe('none');
  });

  it('nothing happens while an IME is composing', () => {
    for (const k of ['Enter', '+', '-']) {
      expect(act(key(k, { composing: true }), ctx())).toBe('none');
      expect(act(key(k, { composing: true, shift: true }), ctx({ step: 'pay', field: 'cash' }))).toBe('none');
    }
  });

  it('plain Enter and Ctrl+Enter keep their behaviour', () => {
    expect(act(key('Enter'), ctx())).toBe('openPay');
    expect(act(key('Enter'), ctx({ step: 'pay', field: 'cash' }))).toBe('payCash');
    expect(act(key('Enter', { ctrl: true }), ctx({ step: 'pay', field: 'cash' }))).toBe('payCard');
    expect(act(key('Enter'), ctx({ step: 'qty', field: 'qty' }))).toBe('qtyConfirm');
  });
});

describe('Z holds the bill on the payment step', () => {
  const z = (o: Partial<KeyInfo> = {}) => key('z', { letter: 'Z', ...o });
  const pay = (o: Partial<KeyContext> = {}) => ctx({ step: 'pay', field: 'cash', ...o });
  it('Z in Cash received or card part holds', () => {
    expect(act(z(), pay())).toBe('holdBill');
    expect(act(z(), pay({ field: 'cardPart' }))).toBe('holdBill');
  });
  it('Z anywhere else is typing', () => {
    expect(act(z(), pay({ field: 'other' }))).toBe('none');
    expect(act(z(), ctx())).toBe('none');
    expect(act(z(), ctx({ step: 'qty', field: 'qty' }))).toBe('none');
  });
  it('Z is left to an IME', () => expect(act(z({ composing: true }), pay())).toBe('none'));
  it('repeat or busy cannot hold', () => {
    expect(act(z({ repeat: true }), pay())).toBe('swallow');
    expect(act(z(), pay({ busy: true }))).toBe('swallow');
  });
  it('Z with an empty bill does nothing', () => expect(act(z(), pay({ billHasItems: false }))).toBe('swallow'));
  it('Ctrl or Shift with Z is not a hold', () => {
    expect(act(z({ ctrl: true }), pay())).toBe('none');
    expect(act(z({ shift: true }), pay())).toBe('none');
  });
  it('another letter in the cash box is not a hold', () => expect(act(key('a', { letter: 'A' }), pay())).toBe('none'));
});
