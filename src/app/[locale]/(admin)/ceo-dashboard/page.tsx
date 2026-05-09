import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import TimeRangeSelector from '@/components/ceo/TimeRangeSelector';
import { isValidRangeKey, resolveRange, DEFAULT_RANGE } from '@/lib/ceo-time-range';
import { getAdminContext } from '@/lib/admin-auth';
import CeoDashboardClient from './CeoDashboardClient';

export default async function CeoDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale } = await params;

  const ctx = await getAdminContext(new Request('https://ceo-dashboard.internal'));
  if (!ctx) {
    redirect(`/${locale}/login`);
  }
  if (ctx.internalRole !== 'super_admin' && ctx.internalRole !== 'internal_admin') {
    redirect(`/${locale}/dashboard`);
  }

  const { range: rawRange } = await searchParams;
  const rangeKey = isValidRangeKey(rawRange) ? rawRange : DEFAULT_RANGE;
  const { from, to } = resolveRange(rangeKey);

  return (
    <CeoDashboardClient
      from={from}
      to={to}
      rangeSelector={
        <Suspense
          fallback={
            <div className="h-12 w-full skeleton rounded-xl mb-6" />
          }
        >
          <TimeRangeSelector />
        </Suspense>
      }
    />
  );
}
