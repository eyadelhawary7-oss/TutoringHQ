import { Suspense } from 'react';
import PricingPageClient from './PricingPageClient';

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-surface-0)]" />}>
      <PricingPageClient />
    </Suspense>
  );
}
