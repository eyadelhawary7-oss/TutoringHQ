'use client';

import { useLayoutEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export function ThemeToggle() {
  const t = useTranslations('common');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useLayoutEffect(() => {
    const saved = localStorage.getItem('chq-theme') as 'dark' | 'light' | null;
    const initial =
      saved === 'light' || saved === 'dark'
        ? saved
        : document.documentElement.classList.contains('light')
          ? 'light'
          : 'dark';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function applyTheme(next: 'dark' | 'light') {
    const html = document.documentElement;
    if (next === 'light') {
      html.classList.add('light');
    } else {
      html.classList.remove('light');
    }
  }

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    localStorage.setItem('chq-theme', next);
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      aria-label={isDark ? t('switchToLightTheme') : t('switchToDarkTheme')}
      className="flex items-center justify-center w-9 h-9 rounded-lg
                 text-[var(--color-text-secondary)]
                 hover:text-[var(--color-text-primary)]
                 hover:bg-[var(--color-surface-2)]
                 transition-colors duration-fast ease-out"
    >
      {isDark ? (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
