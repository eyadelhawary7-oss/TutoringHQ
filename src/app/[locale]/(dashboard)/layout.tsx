import type { ReactNode } from 'react';

/** Route-group layout for center dashboard subtree (no extra chrome - AppShell wraps at locale root). */
export default function DashboardRouteGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
