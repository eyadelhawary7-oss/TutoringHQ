'use client';

import type { ReactNode } from 'react';
import { PullToRefresh } from './PullToRefresh';

type MobileWrapperProps = {
  children: ReactNode;
};

export function MobileWrapper({ children }: MobileWrapperProps) {
  return (
    <PullToRefresh>
      <div className="p-6 max-w-7xl mx-auto pt-14 md:pt-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-8 min-h-full">
        {children}
      </div>
    </PullToRefresh>
  );
}
