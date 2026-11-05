import { useEffect, useState } from 'react';
import { useI18n } from './i18n';

// Appearance (ADR-1). A per-till preference like the language: kept across restarts and logouts.
// Switching only changes <html data-theme>, so nothing in React state (e.g. an open bill) is touched.

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'pos.theme';
const CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

export function savedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The theme actually shown for a choice. */
export function resolveTheme(choice: ThemeChoice, osDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (osDark ? 'dark' : 'light') : choice;
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(choice, systemDark());
  root.dataset.themeChoice = choice;
}

/** Call once before the first render, so the app never flashes the wrong theme. */
export function initTheme(): void {
  applyTheme(savedTheme());
  if (typeof matchMedia === 'function') {
    // "System" follows Windows live when its light/dark setting changes.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (savedTheme() === 'system') applyTheme('system');
    });
  }
}

export function ThemeSelect() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ThemeChoice>(savedTheme);
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* storage unavailable: the choice lasts until restart */
    }
  }, [choice]);
  return (
    <select aria-label="appearance" className="theme-select" value={choice} onChange={(e) => setChoice(e.target.value as ThemeChoice)} title={t('Appearance')}>
      <option value="light">{t('Light')}</option>
      <option value="dark">{t('Dark')}</option>
      <option value="system">{t('System')}</option>
    </select>
  );
}
