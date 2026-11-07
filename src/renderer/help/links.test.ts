import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES } from './content';

const dir = join(__dirname, '..');
const links = readdirSync(dir)
  .filter((f) => f.endsWith('.tsx'))
  .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/<HelpLink article="([^"]+)"/g)].map((m) => ({ file: f, id: m[1]! })));

describe('contextual help links', () => {
  it('every "?" link opens an article that exists', () => {
    const ids = new Set(HELP_ARTICLES.map((a) => a.id));
    for (const l of links) expect(ids.has(l.id), `${l.file}: ${l.id}`).toBe(true);
  });

  it('the complex screens have a "?" link', () => {
    const files = new Set(links.map((l) => l.file));
    for (const f of ['Sell.tsx', 'Customers.tsx', 'Purchases.tsx', 'Stock.tsx', 'Refund.tsx', 'Expenses.tsx']) expect(files.has(f), f).toBe(true);
  });
});
