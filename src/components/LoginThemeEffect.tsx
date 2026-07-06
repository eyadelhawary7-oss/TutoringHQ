'use client';

import { useEffect } from 'react';

/**
 * The auth pages (/signup, /session-expired, /accept-invite) are a deliberate,
 * dark-locked design (see the "Marketing / auth dark locks" block in globals.css)
 * that resolve their surface tokens through a `.dark` scope. Since the app-wide
 * dark theme was removed, this effect is the only thing that adds `.dark` to the
 * document root, and it does so only while one of those pages is mounted — it
 * removes it again on unmount so the rest of the app always renders light.
 *
 * No theme persistence is read or written here; there is a single light theme.
 */
export function LoginThemeEffect() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
    return () => {
      root.classList.remove('dark');
    };
  }, []);

  return null;
}
