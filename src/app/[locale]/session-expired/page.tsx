'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function SessionExpiredPage() {
  const t = useTranslations('sessionExpired');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const PLAYFAIR = {
    fontFamily: "var(--font-playfair), 'Playfair Display', 'Didot', Georgia, serif",
  } as const;
  const SANS = {
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as const;

  return (
    <div
      data-chq-session-expired
      className="chq-page box-border m-0 flex min-h-screen min-h-[100dvh] w-full max-w-full items-center justify-center overflow-x-clip antialiased"
      dir={dir}
      style={{
        background: 'var(--color-surface-0)',
        minHeight: '100vh',
        width: '100%',
        padding: '40px 24px',
      }}
    >
      <div className="chq-spring-in w-full" style={{ maxWidth: '400px' }}>
        <div
          style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border)',
            borderRadius: '20px',
            boxShadow: 'var(--shadow-md)',
            padding: '40px 32px',
            textAlign: 'center',
          }}
        >
          <div
            className="mx-auto flex items-center justify-center"
            style={{
              height: '64px',
              width: '64px',
              borderRadius: '18px',
              background: 'var(--color-teal-soft)',
              border: '1px solid var(--color-border-brand)',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-teal)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>

          <h1
            style={{
              ...PLAYFAIR,
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.2px',
              lineHeight: 1.2,
              marginTop: '24px',
            }}
          >
            {t('title')}
          </h1>

          <p
            style={{
              ...SANS,
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              marginTop: '12px',
            }}
          >
            {t('desc')}
          </p>

          <Link
            href="/login"
            className="btn-press chq-focus inline-flex items-center justify-center"
            style={{
              ...SANS,
              marginTop: '28px',
              width: '100%',
              padding: '14px 24px',
              borderRadius: '12px',
              background: 'var(--color-teal)',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.2px',
              textDecoration: 'none',
            }}
          >
            {t('loginAgain')}
          </Link>
        </div>
      </div>
    </div>
  );
}
