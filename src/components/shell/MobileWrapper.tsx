'use client';

import type { ReactNode } from 'react';
import { PullToRefresh } from './PullToRefresh';

type MobileWrapperProps = {
  children: ReactNode;
  /** Admin console: full width next to sidebar (no max-w-7xl / mx-auto) */
  fullWidth?: boolean;
};

export function MobileWrapper({ children, fullWidth }: MobileWrapperProps) {
  return (
    <PullToRefresh>
      <div
        className={
          fullWidth
            ? 'w-full flex-1 flex flex-col min-h-0'
            : 'p-6 max-w-7xl mx-auto pt-14 lg:pt-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] lg:pb-8 min-h-full'
        }
      >
        {children}
      </div>
    </PullToRefresh>
  );
}
