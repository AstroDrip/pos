import { describe, expect, it } from 'vitest';
import { moveActive, shouldQuery } from './suggest-keys';

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
