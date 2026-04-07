'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/routing';
import { isChqThemePublicPath } from '@/lib/chq-theme-paths';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const allowLight = isChqThemePublicPath(pathname);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      themes={['dark', 'light']}
      enableSystem={false}
      forcedTheme={allowLight ? undefined : 'dark'}
    >
      {children}
    </NextThemesProvider>
  );
}
