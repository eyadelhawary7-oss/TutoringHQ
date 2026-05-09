'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/i18n/routing';

/**
 * Super-admin only (caller gates visibility). Live excludes test centers in aggregates; Test passes include_test=1.
 */
export function TestLiveToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const live = searchParams?.get('include_test') !== '1';

  const apply = (nextLive: boolean) => {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextLive) {
      p.delete('include_test');
    } else {
      p.set('include_test', '1');
    }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
    router.refresh();
  };

  return (
    <div
      className="inline-flex rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-0.5 text-xs font-medium"
      role="group"
      aria-label="Aggregate data mode"
    >
      <button
        type="button"
        onClick={() => apply(true)}
        className={`rounded-md px-3 py-1 transition-colors ${
          live ? 'bg-teal-600 text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-1)]'
        }`}
      >
        Live
      </button>
      <button
        type="button"
        onClick={() => apply(false)}
        className={`rounded-md px-3 py-1 transition-colors ${
          !live ? 'bg-amber-600 text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-1)]'
        }`}
      >
        Test
      </button>
    </div>
  );
}
