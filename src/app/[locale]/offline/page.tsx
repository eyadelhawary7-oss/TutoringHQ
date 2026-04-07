'use client';

import { useTranslations, useLocale } from 'next-intl';

export default function OfflinePage() {
  const t = useTranslations('offline');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#080D14] p-6"
      dir={dir}
    >
      <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-800/40 bg-amber-900/20">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#F59E0B"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a15 15 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t('title')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('desc')}</p>
        </div>
        <div className="rounded-xl border border-teal-800/40 bg-teal-900/20 p-4 text-start text-sm text-teal-300">
          {t('scannerNote')}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-slate-700 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-600 btn-press chq-focus"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
