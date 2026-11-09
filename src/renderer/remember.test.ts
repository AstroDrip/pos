import { describe, expect, it } from 'vitest';
import { memoryKey, readMemory, writeMemory, type StorageLike } from './remember';

const fake = (start: Record<string, string> = {}) => {
  const data = new Map(Object.entries(start));
  const store: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return { store, data };
};
const isText = (v: unknown): v is string => typeof v === 'string';
const broken: StorageLike = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('full'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('remembered values', () => {
  it('reads back what was written', () => {
    const { store } = fake();
    writeMemory(store, 'k', 'hello');
    expect(readMemory(store, 'k', 'start', isText)).toBe('hello');
  });

  it('gives the start value when nothing is stored', () => expect(readMemory(fake().store, 'k', 'start', isText)).toBe('start'));

  it('invalid JSON gives the start value and is removed', () => {
    const { store, data } = fake({ k: '{oops' });
    expect(readMemory(store, 'k', 'start', isText)).toBe('start');
    expect(data.has('k')).toBe(false);
  });

  it('a value of the wrong shape gives the start value and is removed', () => {
    const { store, data } = fake({ k: '42' });
    expect(readMemory(store, 'k', 'start', isText)).toBe('start');
    expect(data.has('k')).toBe(false);
  });

  it('a blocked store never throws', () => {
    expect(readMemory(broken, 'k', 'start', isText)).toBe('start');
    expect(() => writeMemory(broken, 'k', 'x')).not.toThrow();
  });

  it('two users never share a key', () => {
    expect(memoryKey(1, 'stock', 'search')).toBe('pos.ui.1.stock.search');
    expect(memoryKey(1, 'stock', 'search')).not.toBe(memoryKey(2, 'stock', 'search'));
  });
});
