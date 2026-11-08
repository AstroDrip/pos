import { describe, expect, it } from 'vitest';
import { enterAction, moveActive, shouldQuery, singleMatch } from './suggest-keys';

describe('singleMatch', () => {
  it('takes the only item, when the list answers exactly this text', () => {
    expect(singleMatch(['a'], 'abc', 'abc')).toBe('a');
  });
  it('refuses an old list or several items', () => {
    expect(singleMatch(['a'], 'ab', 'abc')).toBeNull();
    expect(singleMatch(['a', 'b'], 'abc', 'abc')).toBeNull();
    expect(singleMatch([], 'abc', 'abc')).toBeNull();
  });
});

describe('shouldQuery', () => {
  it('asks from the first character', () => {
    expect(shouldQuery('a', false)).toBe(true);
    expect(shouldQuery('م', false)).toBe(true);
    expect(shouldQuery(' 7 ', false)).toBe(true);
  });
  it('does not ask for blank text or while an IME is composing', () => {
    expect(shouldQuery('', false)).toBe(false);
    expect(shouldQuery('   ', false)).toBe(false);
    expect(shouldQuery('a', true)).toBe(false);
  });
});

describe('moveActive', () => {
  it('moves down and up and stops at the ends', () => {
    expect(moveActive(-1, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(2);
    expect(moveActive(2, 3, 'ArrowUp')).toBe(1);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(0);
  });
  it('returns -1 when the list is empty', () => {
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
    expect(moveActive(-1, 0, 'ArrowUp')).toBe(-1);
  });
});

describe('enterAction', () => {
  const base = { text: 'apple', itemsFor: 'apple', loading: false, open: true, hasActive: true, navigated: false };
  it('picks the highlighted suggestion when the list belongs to the typed text', () => {
    expect(enterAction(base)).toBe('pick');
  });
  it('never picks a list that belongs to older text (typed fast, or a slow scanner)', () => {
    expect(enterAction({ ...base, text: 'A12', itemsFor: 'a' })).toBe('code');
    expect(enterAction({ ...base, text: 'a6281000000000', itemsFor: 'a' })).toBe('code');
  });
  it('never picks while an answer is still on its way', () => {
    expect(enterAction({ ...base, loading: true })).toBe('code');
  });
  it('codes (digits, or letters with digits) use the exact lookup unless the cashier moved the highlight', () => {
    expect(enterAction({ ...base, text: '6281000000000', itemsFor: '6281000000000' })).toBe('code');
    expect(enterAction({ ...base, text: 'A12', itemsFor: 'A12' })).toBe('code');
    expect(enterAction({ ...base, text: 'A12', itemsFor: 'A12', navigated: true })).toBe('pick');
  });
  it('looks up the text when nothing is highlighted or the list is closed', () => {
    expect(enterAction({ ...base, hasActive: false })).toBe('code');
    expect(enterAction({ ...base, open: false })).toBe('code');
  });
});
