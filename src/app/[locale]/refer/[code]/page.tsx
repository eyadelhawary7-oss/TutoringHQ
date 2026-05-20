'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Gift, Loader2 } from 'lucide-react';
import { setReferralCode } from '@/lib/referralCode';

export default function ReferPage() {
  const params = useParams();
  const locale = useLocale();
  const t = useTranslations('refer');
  const code = typeof params?.code === 'string' ? params.code.trim().toUpperCase() : '';
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isRTL = locale === 'ar' || locale.startsWith('ar');

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError(true);
      return;
    }
    setReferralCode(code);
    document.cookie = `chq_referral_code=${encodeURIComponent(code)}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax`;
    const url = new URL(window.location.href);
    url.searchParams.set('ref', code);
    window.history.replaceState({}, '', url.toString());

    fetch('/api/referral/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.valid && data?.referrerName) {
          setReferrerName(data.referrerName);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-teal-50 to-slate-50"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <Loader2 className="w-10 h-10 animate-spin text-teal-600 mb-4" />
        <p className="text-[var(--color-text-secondary)]">{t('loading')}</p>
      </div>
    );
  }

  if (error || !code) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-teal-50 to-slate-50"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="text-center max-w-md">
          <p className="text-[var(--color-text-secondary)] mb-4">{t('invalidLink')}</p>
          <Link href="/" className="text-teal-600 font-medium hover:underline">
            {t('backHome')}
          </Link>
        </div>
      </div>
    );
  }

  const centerLabel = referrerName ?? t('fallbackCenterName');

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-br from-teal-50 to-slate-50"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-xl p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center mx-auto mb-6">
          <Gift className="w-8 h-8 text-teal-600" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">{t('welcomeTitle')}</h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          {t('invitedBy', { centerName: centerLabel })}
        </p>
        <Link
          href={`/signup?ref=${encodeURIComponent(code)}`}
          className="inline-flex items-center justify-center w-full py-4 px-6 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg transition-colors"
        >
          {t('ctaButton')}
        </Link>
        <p className="text-xs text-[var(--color-text-secondary)] mt-6">{t('autoApplyNote')}</p>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono font-medium">{code}</p>
      </div>
    </div>
  );
}
