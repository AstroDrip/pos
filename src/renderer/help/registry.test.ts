import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRECT_SHORTCUTS, QUICK_ACTIONS } from '../keyboard-registry';
import { HELP_ARTICLES } from './content';
import { FIELDS } from './fields';
import { METRICS } from './metrics';
import { LABEL_SKIPS } from './skip-list';

const dir = join(__dirname, '..');
const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
const source = (f: string) => readFileSync(join(dir, f), 'utf8');
const all = [...FIELDS, ...METRICS];
const COVERED = ['Sell.tsx', 'CustomerBox.tsx', 'Refund.tsx', 'Stock.tsx', 'Products.tsx', 'Shift.tsx', 'Customers.tsx', 'Purchases.tsx', 'SupplierBill.tsx', 'Expenses.tsx', 'Admin.tsx', 'StoreDetailsCard.tsx'];
const used = () => {
  const text = screens.map(source).join('\n');
  return {
    ids: new Set([...text.matchAll(/(?:InfoIcon id|info)="((?:field|metric)\.[\w.]+)"/g)].map((m) => m[1]!)),
    prefixes: [...text.matchAll(/`((?:field|metric)\.[\w.]+\.)\$\{/g)].map((m) => m[1]!),
  };
};

describe('field and figure help', () => {
  it('ids are unique', () => expect(new Set(all.map((h) => h.id)).size).toBe(all.length));

  it('every icon id in the screens exists', () => {
    const known = new Set(all.map((h) => h.id));
    expect([...used().ids].filter((id) => !known.has(id))).toEqual([]);
  });

  it('every entry is used by an icon', () => {
    const { ids, prefixes } = used();
    expect(all.filter((h) => !ids.has(h.id) && !prefixes.some((p) => h.id.startsWith(p))).map((h) => h.id)).toEqual([]);
  });

  it('no entry has an empty required text', () => {
    for (const h of all) for (const [k, v] of Object.entries(h)) if (typeof v === 'string') expect(v.trim(), `${h.id}.${k}`).not.toBe('');
  });

  it('each linked article exists', () => {
    const ids = new Set(HELP_ARTICLES.map((a) => a.id));
    expect(all.filter((h) => h.article && !ids.has(h.article)).map((h) => `${h.id} -> ${h.article}`)).toEqual([]);
  });

  it('every label on the covered screens has an icon or a written reason', () => {
    const skip = new Set(LABEL_SKIPS.map((s) => `${s.file}|${s.label}`));
    const missing: string[] = [];
    for (const file of COVERED) {
      for (const m of source(file).matchAll(/<label\b[^>]*>(.*?)<\/label>/g)) {
        const text = m[1]!;
        if (text.includes('<InfoIcon')) continue;
        const label = /t\(['"](.+?)['"]/.exec(text)?.[1] ?? text.replace(/<[^>]+>/g, '').trim();
        if (!skip.has(`${file}|${label}`)) missing.push(`${file}: ${label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every skip has a reason', () => {
    for (const s of LABEL_SKIPS) expect(s.why.trim(), s.label).not.toBe('');
  });

  it('every shortcut has help text', () => {
    for (const s of DIRECT_SHORTCUTS) expect(s.help.trim(), s.id).not.toBe('');
    for (const a of QUICK_ACTIONS) expect(a.help.trim(), a.id).not.toBe('');
  });
});
