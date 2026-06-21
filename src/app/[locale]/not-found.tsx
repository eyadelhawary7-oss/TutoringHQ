'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Globe } from 'lucide-react';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

type Locale = 'ar' | 'en';

function readLocaleFromPath(): Locale {
  if (typeof window === 'undefined') return 'ar';
  const path = window.location.pathname;
  if (path === '/en' || path.startsWith('/en/')) return 'en';
  return 'ar';
}

export default function NotFound() {
  const [locale, setLocale] = useState<Locale>(readLocaleFromPath);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setLocale(readLocaleFromPath());
  }, []);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const messages = locale === 'en' ? en : ar;
  const t = (key: keyof typeof messages.errors.notFound): string => {
    const v = messages.errors.notFound[key];
    return typeof v === 'string' ? v : '';
  };

  const handleLocaleToggle = () => {
    const next: Locale = locale === 'ar' ? 'en' : 'ar';
    const currentPath = pathname || `/${locale}`;
    const newPath = currentPath.startsWith(`/${locale}`)
      ? currentPath.replace(`/${locale}`, `/${next}`)
      : `/${next}${currentPath}`;
    startTransition(() => router.replace(newPath));
  };

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--color-surface-2)] p-6"
      dir={dir}
    >
      <div className="absolute end-4 top-4">
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:text-white"
        >
          <Globe size={13} aria-hidden />
          <span dir="ltr">{locale === 'ar' ? 'EN' : 'AR'}</span>
        </button>
      </div>

      <div className="w-full max-w-md space-y-6 text-center">
        <a
          href={`/${locale}`}
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
        </a>

        <div className="text-7xl font-bold leading-none text-slate-700" aria-hidden>
          404
        </div>

        <div>
          <h1 className="text-xl font-semibold text-white">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('message')}</p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={`/${locale}`}
            className="inline-flex w-full justify-center rounded-xl bg-teal-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-teal-500 btn-press chq-focus sm:w-auto"
          >
            {t('backToHome')}
          </a>
          <a
            href={`/${locale}/pricing`}
            className="inline-flex w-full justify-center rounded-xl border border-slate-600 bg-transparent px-6 py-3 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white btn-press chq-focus sm:w-auto"
          >
            {t('viewPricing')}
          </a>
        </div>
      </div>
    </div>
  );
}
