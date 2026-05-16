'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';
import { formatNumber } from '@/lib/formatNumber';

export default function NotFound() {
  const t = useTranslations('errors');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const waSupport = getSupportWhatsAppWaMeBase();

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[var(--color-surface-0)] p-6"
      dir={dir}
    >
      <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
          CH
        </div>
        <div className="text-8xl font-bold leading-none text-slate-800" aria-hidden>
          {formatNumber(404, locale)}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">{t('notFoundTitle')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('notFoundDesc')}</p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="inline-flex rounded-xl bg-teal-600 px-6 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {t('goHome')}
          </Link>
          {waSupport ? (
            <a
              href={waSupport}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-teal-400 underline-offset-2 transition-colors hover:text-teal-300 hover:underline btn-press chq-focus rounded-lg px-2 py-1"
            >
              {t('contactSupport')}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
