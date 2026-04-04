import { Suspense } from 'react';
import TimeRangeSelector from '@/components/ceo/TimeRangeSelector';
import { isValidRangeKey, resolveRange, DEFAULT_RANGE } from '@/lib/ceo-time-range';
import CeoDashboardClient from './CeoDashboardClient';

export default async function CeoDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  await params;
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
