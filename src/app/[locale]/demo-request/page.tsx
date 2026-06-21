'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';

const WHATSAPP_URL = 'https://wa.me/201001234567';

export default function DemoRequestPage() {
  const t = useTranslations('demoRequest.stub');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-surface-2)] px-6 py-16"
      dir={dir}
    >
      <div className="w-full max-w-md space-y-6 text-center">
        <Link
          href="/"
          className="mx-auto inline-flex items-center gap-2 chq-focus rounded-lg"
          aria-label="TutoringHQ"
        >
          <span
            className="text-base tracking-tight"
            style={{
              fontFamily: 'var(--font-bodoni)',
              fontWeight: 700,
              letterSpacing: '2px',
            }}
          >
            <span className="text-[#f8fafc]">Tutoring</span>
            <span className="text-[#0D9488]">HQ</span>
          </span>
        </Link>

        <div>
          <h1 className="text-2xl font-semibold text-white md:text-3xl">{t('title')}</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)] md:text-base">
            {t('message')}
          </p>
        </div>

        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
        >
          {t('whatsappCta')}
        </a>
      </div>
    </div>
  );
}
