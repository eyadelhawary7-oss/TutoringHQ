import type { ReactNode } from 'react';

export default function AdminSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <div data-admin="true" className="min-h-screen min-h-0 flex flex-col bg-gray-50 dark:bg-slate-950">
      {/* Fixed AdminHeader is h-14 — offset main content below it */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col pt-14">{children}</div>
    </div>
  );
}
