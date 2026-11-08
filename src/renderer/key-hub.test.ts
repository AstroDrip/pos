import { describe, expect, it, vi } from 'vitest';
import { KeyHub } from './key-hub';

function target() {
  const fns = new Set<(e: KeyboardEvent) => void>();
  return {
    fns,
    addEventListener: (_t: 'keydown', f: (e: KeyboardEvent) => void) => void fns.add(f),
    removeEventListener: (_t: 'keydown', f: (e: KeyboardEvent) => void) => void fns.delete(f),
    fire: (e: Partial<KeyboardEvent>) => fns.forEach((f) => f(e as KeyboardEvent)),
  };
}

describe('KeyHub', () => {
  it('registers one listener however many times it is attached, and removes it', () => {
    const t = target();
    const hub = new KeyHub();
    hub.attach(t);
    hub.attach(t);
    expect(t.fns.size).toBe(1);
    hub.detach();
    expect(t.fns.size).toBe(0);
  });

  it('the scanner goes first and can claim the key', () => {
    const t = target();
    const hub = new KeyHub();
    const calls: string[] = [];
    hub.setHandler(() => void calls.push('handler'));
    hub.attach(t);
    const off = hub.setScanner(() => (calls.push('scan'), true));
    t.fire({ key: 'Enter' });
    expect(calls).toEqual(['scan']);
    off();
    t.fire({ key: 'Enter' });
    expect(calls).toEqual(['scan', 'handler']);
  });

  it('a stale scanner cleanup does not remove the current one', () => {
    const hub = new KeyHub();
    const a = vi.fn(() => false);
    const b = vi.fn(() => false);
    const offA = hub.setScanner(a);
    hub.setScanner(b);
    offA();
    hub.handle({ key: 'x' } as KeyboardEvent);
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });
});
