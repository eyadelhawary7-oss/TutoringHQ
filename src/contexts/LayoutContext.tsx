'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface LayoutContextValue {
  mode: 'app';
  setMode: (mode: string) => void;
  toggleMode: () => void;
  hideShell: boolean;
  setHideShell: (hide: boolean) => void;
  /** Scanner kiosk: hide shell navigation until PIN unlock */
  scannerKioskLocked: boolean;
  setScannerKioskLocked: (locked: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [hideShell, setHideShell] = useState(false);
  const [scannerKioskLocked, setScannerKioskLocked] = useState(false);

  const value: LayoutContextValue = {
    mode: 'app',
    setMode: () => {},
    toggleMode: () => {},
    hideShell,
    setHideShell,
    scannerKioskLocked,
    setScannerKioskLocked,
  };

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
