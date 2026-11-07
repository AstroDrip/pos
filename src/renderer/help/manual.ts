import { HELP_ARTICLES, HELP_SECTIONS, type HelpArticle } from './content';

/** Markdown user manual built from the Help Centre content (docs/user-guide/POS_USER_MANUAL.md). */
export function renderManual(): string {
  const out: string[] = [
    '# POS User Manual',
    '',
    '<!-- Generated from src/renderer/help/content.ts by `npm run manual`. Do not edit by hand: edit the help content. -->',
    '',
    'This manual is the same text as the Help tab in the app. It covers only what the app does today.',
    'Names and numbers in the examples are made up.',
    '',
    '## Contents',
    '',
  ];
  for (const s of HELP_SECTIONS) {
    const list = HELP_ARTICLES.filter((a) => a.section === s.id);
    if (!list.length) continue;
    out.push(`- **${s.title}**`);
    for (const a of list) out.push(`  - [${a.title}](#${a.id})`);
  }
  out.push('');
  for (const s of HELP_SECTIONS) {
    const list = HELP_ARTICLES.filter((a) => a.section === s.id);
    if (!list.length) continue;
    out.push(`## ${s.title}`, '');
    for (const a of list) out.push(...article(a));
  }
  return out.join('\n');
}

function article(a: HelpArticle): string[] {
  const out = [`<a id="${a.id}"></a>`, '', `### ${a.title}`, '', `**What this does:** ${a.what}`, ''];
  if (a.where) out.push(`**Where:** ${a.where}`, '');
  if (a.keys?.length) out.push(`**Keys:** ${a.keys.map((k) => `\`${k}\``).join(' ')}`, '');
  out.push('**Steps**', '');
  a.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push('', `**What you should see:** ${a.expect}`, '');
  if (a.problems.length) {
    out.push('**If something goes wrong**', '');
    for (const p of a.problems) out.push(`- *${p.problem}* ${p.fix}`);
    out.push('');
  }
  if (a.supervisor) out.push(`**Ask a supervisor:** ${a.supervisor}`, '');
  return out;
}
