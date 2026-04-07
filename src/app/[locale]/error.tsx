'use client';

import { useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    console.error('[CenterHQ Error]', error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[var(--color-surface-0)] p-6"
      dir={dir}
    >
      <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-800/50 bg-red-900/30">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div>
          <h1 className="mb-2 text-xl font-semibold text-white">{t('unexpectedTitle')}</h1>
          <p className="text-sm text-slate-400">{t('unexpectedDesc')}</p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-slate-600">{error.digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {t('tryAgain')}
          </button>
          <Link
            href="/dashboard"
            className="rounded-xl bg-slate-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-600 btn-press chq-focus"
          >
            {t('goDashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
}
