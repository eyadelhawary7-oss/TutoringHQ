'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type LayoutMode = 'app' | 'web';

const STORAGE_KEY = 'centerhq-layout-mode';

function getInitialMode(): LayoutMode {
  if (typeof window === 'undefined') return 'web';
  const saved = localStorage.getItem(STORAGE_KEY) as LayoutMode | null;
  if (saved === 'app' || saved === 'web') return saved;
  return window.innerWidth >= 768 ? 'web' : 'app';
}

interface LayoutContextValue {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  toggleMode: () => void;
  hideShell: boolean;
  setHideShell: (hide: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>('web');
  const [hideShell, setHideShell] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setModeState(getInitialMode());
    setMounted(true);
  }, []);

  const setMode = useCallback((next: LayoutMode) => {
    setModeState(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'app' ? 'web' : 'app';
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, next);
      }
      return next;
    });
  }, []);

  const value: LayoutContextValue = {
    mode: mounted ? mode : 'web',
    setMode,
    toggleMode,
    hideShell,
    setHideShell,
  };

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
