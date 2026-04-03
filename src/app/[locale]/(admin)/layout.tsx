import type { ReactNode } from 'react';

/** CEO dashboard and other routes under (admin) that are not under /admin/ */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  return <div data-admin="true">{children}</div>;
}
