import type { ReactNode } from 'react';

export default function AdminSegmentLayout({ children }: { children: ReactNode }) {
  return <div data-admin="true">{children}</div>;
}
