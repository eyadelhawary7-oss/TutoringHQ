'use client';

import { useEffect } from 'react';
import { Link } from '@/i18n/routing';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <div className="w-16 h-16 rounded-full bg-[rgba(239,68,68,0.12)] flex items-center justify-center">
        <svg
          width="28"
          height="28"
          fill="none"
          stroke="var(--color-danger)"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">حدث خطأ</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Something went wrong</p>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          حاول مجدداً
        </button>
        <Link href="/dashboard" className="btn btn-ghost">
          الرئيسية
        </Link>
      </div>
    </div>
  );
}
