import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARABIC_KEYS, translate } from './i18n';

describe('Arabic dictionary', () => {
  it('every t("...") phrase used in the UI has an Arabic translation', () => {
    const used = new Set<string>();
    for (const f of readdirSync(__dirname).filter((x) => x.endsWith('.tsx') && x !== 'i18n.tsx')) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      for (const m of src.matchAll(/\bt\((['"])((?:(?!\1).)+)\1/g)) used.add(m[2]!.replace(/\'/g, "'"));
    }
    const missing = [...used].filter((k) => !ARABIC_KEYS.includes(k));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });

  it('fills placeholders and falls back to English', () => {
    expect(translate('ar', 'Shift #{0}', 7)).toBe('الوردية رقم 7');
    expect(translate('en', 'Shift #{0}', 7)).toBe('Shift #7');
    expect(translate('ar', 'Some new text')).toBe('Some new text');
  });
});
