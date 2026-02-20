'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Light-only app — ThemeContext is a no-op kept for import compatibility
const ThemeContext = createContext<{
  theme: 'light';
  setTheme: (t: string) => void;
}>({ theme: 'light', setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
