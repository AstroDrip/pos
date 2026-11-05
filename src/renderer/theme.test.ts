import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('appearance (ADR-1)', () => {
  it('system follows the OS; light and dark are fixed', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('both themes define every colour token', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    const names = (b: string) => [...b.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    const light = names(block(":root[data-theme='light'] {"));
    const dark = names(block(":root[data-theme='dark'] {"));
    expect(light.length).toBeGreaterThan(20);
    expect(dark).toEqual(light);
  });

  it('components use tokens, not hardcoded colours', () => {
    for (const f of readdirSync(__dirname).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect([f, src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)]).toEqual([f, null]);
    }
  });
});
