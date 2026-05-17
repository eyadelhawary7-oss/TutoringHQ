'use client';

import { Suspense, useLayoutEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';

const TAB_REDIRECTS: Record<string, string> = {
  general: '/settings/general',
  team: '/settings/team',
  billing: '/settings/billing',
};

function SettingsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get('tab');

  useLayoutEffect(() => {
    const tab = rawTab?.trim().toLowerCase() ?? '';
    const target = TAB_REDIRECTS[tab] ?? '/settings/general';
    router.replace(target as never, { scroll: false });
  }, [router, rawTab]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)]">
      <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)]">
          <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
        </div>
      }
    >
      <SettingsRedirect />
    </Suspense>
  );
}
