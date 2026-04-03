import type { ReactNode } from 'react';

export default function AdminSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <div data-admin="true" className="min-h-0 bg-gray-50 dark:bg-slate-950">
      {children}
    </div>
  );
}
