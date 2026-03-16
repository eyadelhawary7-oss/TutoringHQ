'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface SidebarContextValue {
  closeMainSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  children,
  closeMainSidebar,
}: {
  children: ReactNode;
  closeMainSidebar: () => void;
}) {
  return (
    <SidebarContext.Provider value={{ closeMainSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  return ctx;
}
