'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'chq-theme';

function applyRootThemeClass(theme: string) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme === 'light' ? 'light' : 'dark');
}

/**
 * Login is always dark. Restores the user's stored theme on the document root when leaving.
 */
export function LoginThemeEffect() {
  useEffect(() => {
    applyRootThemeClass('dark');
    return () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY) || 'dark';
        applyRootThemeClass(stored);
      } catch {
        applyRootThemeClass('dark');
      }
    };
  }, []);

  return null;
}
