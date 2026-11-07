import { HELP_ARTICLES } from './help/content';
import { useOpenHelp } from './help/HelpContext';
import { useI18n } from './i18n';

/** A small "?" button that opens the matching Help article. */
export function HelpLink({ article }: { article: string }) {
  const { t } = useI18n();
  const open = useOpenHelp();
  const a = HELP_ARTICLES.find((x) => x.id === article);
  if (!a) return null;
  return (
    <button type="button" className="help-link" aria-label={`Help: ${a.title}`} title={`${t('Help')}: ${a.title}`} onClick={() => open(article)}>
      ?
    </button>
  );
}
