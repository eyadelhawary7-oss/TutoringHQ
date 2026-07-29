'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { countRejectedScans, getRejectedScans, clearRejectedScans } from '@/lib/db';
import { formatNumber } from '@/lib/formatNumber';

/**
 * Operator-visible surface for dead-lettered scans (Job 3, Part 8). A scan taken while
 * the centre was locked is permanently rejected by the server and PARKED in the local
 * rejected_scans store instead of being destroyed. This banner shows how many are
 * parked and lets an operator export them (JSON, for manual reconciliation) and then
 * clear them. Renders nothing when there are none. All reads happen client-side in an
 * effect, so there is no IndexedDB access during SSR.
 */
export function RejectedScansBanner() {
  const t = useTranslations('attendance');
  const locale = useLocale();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const n = await countRejectedScans();
        if (!cancelled) setCount(n);
      } catch {
        // Best-effort: if the store cannot be read, just show no banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (count <= 0) return null;

  const onExport = async () => {
    const rows = await getRejectedScans();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rejected-scans-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onClear = async () => {
    await clearRejectedScans();
    setCount(0);
  };

  return (
    <div className="mx-auto mt-3 w-full max-w-lg rounded-xl border border-amber-800/40 bg-amber-900/20 p-3 text-start">
      <p className="text-sm font-semibold text-amber-300">{t('rejectedTitle')}</p>
      <p className="mt-1 text-xs text-amber-200/80">
        {t('rejectedBody', { count: formatNumber(count, locale) })}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void onExport()}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
        >
          {t('rejectedExport')}
        </button>
        <button
          type="button"
          onClick={() => void onClear()}
          className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-900/30"
        >
          {t('rejectedClear')}
        </button>
      </div>
    </div>
  );
}
