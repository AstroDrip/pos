import { useEffect, useMemo, useState } from 'react';
import { searchHelp } from '../core/help-search';
import { HELP_ARTICLES, HELP_SECTIONS, type HelpArticle } from './help/content';
import { DIRECT_SHORTCUTS, QUICK_ACTIONS } from './keyboard-registry';
import { useBindings, useShortcuts } from './Keyboard';
import { useI18n } from './i18n';
import { PageHeader } from './PageHeader';

const SIZE_KEY = 'pos.helpSize';
const readSize = () => {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return v >= 1 && v <= 3 ? v : 2;
  } catch {
    return 2;
  }
};

/** Help Centre: step-by-step guides for every feature (English for now), searchable from the first letter. */
export function Help({ initial }: { initial?: string }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [current, setCurrent] = useState<string>(initial ?? HELP_ARTICLES[0]!.id);
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    if (initial) setCurrent(initial);
  }, [initial]);
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {
      // text size is a per-till convenience only
    }
  }, [size]);

  const found = useMemo(() => searchHelp(HELP_ARTICLES, text), [text]);
  const article = HELP_ARTICLES.find((a) => a.id === current) ?? HELP_ARTICLES[0]!;

  return (
    <div className="page help" data-size={size}>
      <PageHeader
        title={t('Help')}
        desc={t('Step-by-step guides for every part of the app.')}
        actions={
          <>
            <span className="seg" role="group" aria-label={t('Text size')} dir="ltr">
              <button type="button" aria-label="smaller text" disabled={size <= 1} onClick={() => setSize(size - 1)}>A−</button>
              <button type="button" aria-label="larger text" disabled={size >= 3} onClick={() => setSize(size + 1)}>A+</button>
            </span>
            <button type="button" onClick={() => window.print()}>{t('Print this guide')}</button>
          </>
        }
      />
      {lang === 'ar' && <p className="msg warn">{t('Help is available in English for now.')}</p>}
      <div className="help-layout" lang="en" dir="ltr">
        <nav className="help-nav" aria-label="help topics">
          <input data-kb-search="help" aria-label="help search" placeholder="Search help" value={text} onChange={(e) => setText(e.target.value)} />
          {text.trim() ? (
            <ul>
              {found.length === 0 && <li className="none">No guide matches. Try another word.</li>}
              {found.map((a) => <Item key={a.id} a={a} on={a.id === article.id} pick={setCurrent} />)}
            </ul>
          ) : (
            HELP_SECTIONS.map((s) => (
              <section key={s.id}>
                <h4>{s.title}</h4>
                <ul>
                  {HELP_ARTICLES.filter((a) => a.section === s.id).map((a) => <Item key={a.id} a={a} on={a.id === article.id} pick={setCurrent} />)}
                </ul>
              </section>
            ))
          )}
        </nav>
        <article className="help-article">
          <p className="help-section">{HELP_SECTIONS.find((s) => s.id === article.section)?.title}</p>
          <h3>{article.title}</h3>
          <p><strong>What this does.</strong> {article.what}</p>
          {article.where && <p><strong>Where.</strong> {article.where}</p>}
          {article.keys && (
            <p className="help-keys"><strong>Keys.</strong> {article.keys.map((k) => <kbd key={k}>{k}</kbd>)}</p>
          )}
          {article.keys && <LiveKeys />}
          <h4>Steps</h4>
          <ol className="help-steps">
            {article.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <h4>What you should see</h4>
          <p>{article.expect}</p>
          {article.problems.length > 0 && (
            <>
              <h4>If something goes wrong</h4>
              <dl className="help-problems">
                {article.problems.map((p, i) => (
                  <div key={i}><dt>{p.problem}</dt><dd>{p.fix}</dd></div>
                ))}
              </dl>
            </>
          )}
          {article.supervisor && <p className="help-supervisor"><strong>Ask a supervisor.</strong> {article.supervisor}</p>}
        </article>
      </div>
    </div>
  );
}

/** The guides list the standard keys. If the admin changed any, this says which keys this till really uses. */
function LiveKeys() {
  const b = useBindings();
  const { overrides } = useShortcuts();
  if (Object.keys(overrides).length === 0) return null;
  const rows = [
    ...DIRECT_SHORTCUTS.filter((s) => s.id in overrides).map((s) => [s.action, b.direct[s.id as keyof typeof b.direct]] as const),
    ...QUICK_ACTIONS.filter((a) => `letter.${a.id}` in overrides).map((a) => [a.label, b.letters[a.id]] as const),
  ];
  return (
    <div className="msg warn" aria-label="changed keys">
      <strong>Keys changed on this till.</strong> Use these instead of the standard keys below:
      <ul>{rows.map(([label, key]) => <li key={label}>{label}: <kbd>{key}</kbd></li>)}</ul>
    </div>
  );
}

function Item({ a, on, pick }: { a: HelpArticle; on: boolean; pick: (id: string) => void }) {
  return (
    <li>
      <button type="button" className={on ? 'on' : ''} aria-current={on ? 'true' : undefined} onClick={() => pick(a.id)}>{a.title}</button>
    </li>
  );
}
