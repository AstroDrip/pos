'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CloseIcon, SearchIcon } from './icons';

interface Suggestion { id: number; name: string; categoryName: string | null }

export function SearchBox({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  // A short pause, so typing does not send a request for every key.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/store/suggest?q=${encodeURIComponent(q)}`, { signal: stop.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Suggestion[]>) : []))
        .then(setFound)
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [text]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);

  const showing = open && text.trim().length >= 2 ? found : [];

  return (
    <form
      ref={box}
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        if (!q) return;
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-600"><SearchIcon size={20} /></span>
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        type="search"
        maxLength={80}
        placeholder="Search fresh products"
        aria-label="Search products"
        className="min-h-12 w-full rounded-field bg-surface-soft pr-12 pl-12 placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-brand-700 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button type="button" onClick={() => { setText(''); setFound([]); }} aria-label="Clear search" className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center text-ink-600">
          <CloseIcon size={18} />
        </button>
      )}
      {showing.length > 0 && (
        <ul className="absolute z-30 mt-2 w-full overflow-hidden rounded-card bg-surface shadow-float">
          {showing.map((s) => (
            <li key={s.id}>
              <Link href={`/products/${s.id}`} onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 hover:bg-surface-soft">
                <span className="truncate">{s.name}</span>
                {s.categoryName && <span className="shrink-0 text-xs text-ink-600">{s.categoryName}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
