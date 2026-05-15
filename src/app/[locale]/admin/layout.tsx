import type { ReactNode } from 'react';

export default function AdminSegmentLayout({ children }: { children: ReactNode }) {
  return (
    <div data-admin="true" className="min-h-screen min-h-0 flex flex-col bg-[var(--color-surface-0)]">
      {/* Fixed AdminHeader is h-14 - offset main content below it */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col pt-14 lg:ms-56">{children}</div>
    </div>
  );
}
