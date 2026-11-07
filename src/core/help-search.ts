/**
 * Help Centre search: works from the first letter, ignores case, matches titles and search words.
 * Order: title starts with the text > a title word starts with it > a search word starts with it > every typed
 * word appears somewhere. Among equals the content order is kept (articles are written in a sensible order).
 */
export function searchHelp<A extends { title: string; keywords: string[] }>(articles: A[], text: string): A[] {
  const q = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return articles;
  const words = q.split(' ');
  const tier = (a: A): number => {
    const title = a.title.toLowerCase();
    const keys = a.keywords.map((k) => k.toLowerCase());
    if (title.startsWith(q)) return 0;
    if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 1;
    if (keys.some((k) => k.startsWith(q))) return 2;
    const hay = `${title} ${keys.join(' ')}`;
    return words.every((w) => hay.includes(w)) ? 3 : -1;
  };
  return articles
    .map((a, i) => ({ a, i, t: tier(a) }))
    .filter((x) => x.t >= 0)
    .sort((x, y) => x.t - y.t || x.i - y.i)
    .map((x) => x.a);
}
