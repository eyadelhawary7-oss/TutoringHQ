import type { ReactNode } from 'react';

/** CEO dashboard and other routes under (admin) that are not under /admin/ */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  return (
    <div data-admin="true" className="min-h-0 bg-gray-50 dark:bg-slate-950">
      {children}
    </div>
  );
}
