'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="cream"
      themes={['cream', 'dark']}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="chq-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
