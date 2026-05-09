'use client';

import type { ReactNode } from 'react';
import { HydrationBoundary } from '@/components/error/HydrationBoundary';

export default function ScheduleHydrationLayout({ children }: { children: ReactNode }) {
  return <HydrationBoundary>{children}</HydrationBoundary>;
}
