import { Suspense, type ReactNode } from 'react';
import Loading from './loading';

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
