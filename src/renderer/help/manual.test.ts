import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, HELP_SECTIONS } from './content';
import { renderManual } from './manual';

const MANUAL = join(__dirname, '..', '..', '..', 'docs', 'user-guide', 'POS_USER_MANUAL.md');

describe('help content', () => {
  it('has unique ids, a known section, at least one step and an expected result', () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(HELP_SECTIONS.map((s) => s.id));
    for (const a of HELP_ARTICLES) {
      expect(sections.has(a.section), a.id).toBe(true);
      expect(a.steps.length, a.id).toBeGreaterThan(0);
      expect(a.expect.trim(), a.id).not.toBe('');
      expect(a.what.trim(), a.id).not.toBe('');
    }
  });

  it('covers every scenario A to J', () => {
    const titles = HELP_ARTICLES.filter((a) => a.section === 'scenarios').map((a) => a.title[0]);
    expect(titles).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });

  it('does not teach features that are not built', () => {
    // The ZATCA guide exists to say plainly that the link is not set up, so it is the one place the word may appear.
    const text = JSON.stringify(HELP_ARTICLES.filter((a) => a.id !== 'reports-zatca')).toLowerCase();
    for (const banned of ['zatca', 'fatoora', 'sticker', 'type the weight', 'phone dashboard']) expect(text, banned).not.toContain(banned);
  });
});

describe('user manual', () => {
  it('docs/user-guide/POS_USER_MANUAL.md is generated from the help content (run npm run manual)', () => {
    const md = renderManual();
    if (process.env.WRITE_MANUAL === '1') writeFileSync(MANUAL, md, 'utf8');
    expect(readFileSync(MANUAL, 'utf8').replace(/\r\n/g, '\n')).toBe(md);
  });
});
