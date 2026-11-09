'use client';

import { useEffect, useState } from 'react';

const NEXT: Record<string, string> = { system: 'light', light: 'dark', dark: 'system' };

/** Purely a display preference, kept in this browser. */
export function ThemeButton() {
  const [theme, setTheme] = useState('system');
  useEffect(() => {
    try {
      setTheme(localStorage.getItem('theme') ?? 'system');
    } catch {
      /* private window: stay on system */
    }
  }, []);
  const change = () => {
    const t = NEXT[theme] ?? 'system';
    setTheme(t);
    try {
      if (t === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', t);
    } catch {
      /* the choice just does not persist */
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return <button type="button" className="link-row" onClick={change}><span>Appearance</span><span className="sub">{theme === 'system' ? 'Same as phone' : theme === 'light' ? 'Light' : 'Dark'}</span></button>;
}
