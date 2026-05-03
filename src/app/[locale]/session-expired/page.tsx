'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LoginThemeEffect } from '@/components/LoginThemeEffect';

export default function SessionExpiredPage() {
  const t = useTranslations('sessionExpired');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      <LoginThemeEffect />
      <div
        data-chq-session-expired
        className="chq-page box-border m-0 flex min-h-screen min-h-[100dvh] w-full max-w-full items-center justify-center overflow-x-clip bg-[#080f1a] p-0 antialiased"
        dir={dir}
        style={{ backgroundColor: '#080f1a', minHeight: '100vh', width: '100%' }}
      >
        <div className="flex w-full max-w-full justify-center p-6">
          <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-800/40 bg-teal-900/20">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0D9488"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">{t('title')}</h1>
              <p className="mt-2 text-sm text-slate-400">{t('desc')}</p>
            </div>
            <Link
              href="/login"
              className="inline-flex rounded-xl bg-teal-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
            >
              {t('loginAgain')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
