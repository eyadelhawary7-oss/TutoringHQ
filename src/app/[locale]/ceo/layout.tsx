import type { ReactNode } from 'react';

/** CEO tools shell uses AdminSidebar and same scoped admin form styles as /admin */
export default function CeoSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <div data-admin="true" className="min-h-0 bg-gray-50 dark:bg-slate-950">
      {children}
    </div>
  );
}
