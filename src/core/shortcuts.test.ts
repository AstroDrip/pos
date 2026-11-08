import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBOS, comboOf, resolveBindings, validateOverrides, type ComboKey } from './shortcuts';

const k = (key: string, o: Partial<ComboKey> = {}): ComboKey => ({ key, code: '', ctrl: false, shift: false, alt: false, meta: false, ...o });

describe('comboOf', () => {
  it('names keys the same way the settings store them', () => {
    expect(comboOf(k('F1'))).toBe('F1');
    expect(comboOf(k('k', { ctrl: true }))).toBe('Ctrl+K');
    expect(comboOf(k('k', { meta: true }))).toBe('Ctrl+K');
    expect(comboOf(k('Enter', { shift: true }))).toBe('Shift+Enter');
    expect(comboOf(k('Enter', { ctrl: true }))).toBe('Ctrl+Enter');
    expect(comboOf(k('Escape'))).toBe('Esc');
    expect(comboOf(k('F4', { alt: true }))).toBe('Alt+F4');
  });
  it('+ needs Shift on most keyboards, but it is still just +', () => {
    expect(comboOf(k('+', { shift: true, code: 'Equal' }))).toBe('+');
    expect(comboOf(k('-', { code: 'Minus' }))).toBe('-');
  });
  it('uses the physical key on an Arabic layout', () => {
    expect(comboOf(k('ن', { ctrl: true, code: 'KeyK' }))).toBe('Ctrl+K');
    expect(comboOf(k('١', { alt: true, code: 'Digit1' }))).toBe('Alt+1');
  });
  it('a modifier alone is not a shortcut', () => {
    for (const m of ['Control', 'Shift', 'Alt', 'Meta']) expect(comboOf(k(m))).toBeNull();
  });
});

describe('resolveBindings', () => {
  it('uses the defaults when nothing was changed', () => {
    const b = resolveBindings({});
    expect(b.direct).toEqual(DEFAULT_COMBOS);
    expect(b.letters.H).toBe('H');
  });
  it('applies changed keys and letters', () => {
    const b = resolveBindings({ 'palette.open': 'F6', 'letter.H': 'B' });
    expect(b.direct['palette.open']).toBe('F6');
    expect(b.letters.H).toBe('B');
    expect(b.direct['help.open']).toBe('F1');
  });
});

describe('validateOverrides', () => {
  const bad = (o: Record<string, string>) => validateOverrides(o);
  it('accepts function keys and Ctrl or Alt combinations', () => {
    for (const c of ['F6', 'Ctrl+J', 'Alt+P', 'Ctrl+Shift+J', 'Shift+F2', 'Ctrl+1']) expect(bad({ 'palette.open': c }), c).toBeNull();
  });
  it('accepts going back to the default', () => {
    expect(bad({ 'pay.cash': 'Enter', escape: 'Esc', 'qty.inc': '+' })).toBeNull();
  });
  it('refuses keys that would break typing', () => {
    for (const c of ['A', '5', 'Shift+A', 'Enter', 'Esc', '+', '-', 'Shift+Enter', 'Tab', 'ArrowUp', 'Space']) expect(bad({ 'palette.open': c }), c).not.toBeNull();
  });
  it('refuses normal editing and window keys', () => {
    for (const c of ['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Alt+F4', 'Ctrl+R', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+M', 'Ctrl+Shift+I', 'F11', 'F12', 'Ctrl+0']) expect(bad({ 'help.open': c }), c).not.toBeNull();
  });
  it('refuses AltGr (Ctrl+Alt), which types characters', () => {
    expect(bad({ 'help.open': 'Ctrl+Alt+Q' })).not.toBeNull();
  });
  it('refuses two functions on one key, including a default', () => {
    expect(bad({ 'help.open': 'F6', 'palette.open': 'F6' })).not.toBeNull();
    expect(bad({ 'help.open': 'F4' })).not.toBeNull();
    expect(bad({ 'help.open': 'F4', 'qty.focus': 'F9' })).toBeNull(); // the old owner moved away
  });
  it('letters must be one letter and unique', () => {
    expect(bad({ 'letter.H': 'B' })).toBeNull();
    expect(bad({ 'letter.H': 'P' })).not.toBeNull();
    expect(bad({ 'letter.H': 'BB' })).not.toBeNull();
    expect(bad({ 'letter.H': '5' })).not.toBeNull();
  });
  it('refuses a function that does not exist', () => {
    expect(bad({ 'nope.nothing': 'F6' })).not.toBeNull();
    expect(bad({ __proto__x: 'F6' })).not.toBeNull();
  });
});
