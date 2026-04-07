'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';

const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '201220601410';

export default function SuspendedPage() {
  const t = useTranslations('suspended');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const [fawryCode, setFawryCode] = useState('');
  const reason = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('reason') : null;
  const isCenterSuspended = reason === 'center_suspended';
  const isPaymentOverdue = reason === 'payment_overdue';

  useEffect(() => {
    if (isCenterSuspended || isPaymentOverdue) return;

    const loadSubscription = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;

      const { data: subscription } = await dbSelect({
        table: 'subscriptions',
        select: 'fawry_reference',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        single: true,
      });

      const sub = subscription as { fawry_reference?: string } | null;
      if (sub?.fawry_reference) {
        setFawryCode(sub.fawry_reference);
      }
    };
    loadSubscription();
  }, [isCenterSuspended, isPaymentOverdue]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = `/${locale}/login`;
  };

  const waMessage = isPaymentOverdue
    ? t('paymentOverdueWhatsapp', { defaultValue: 'I would like to pay my CenterHQ subscription' })
    : isCenterSuspended
      ? t('centerSuspendedWhatsappMessage')
      : t('whatsappMessage');
  const waHref = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(waMessage)}`;

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-[var(--color-surface-0)] p-6"
      dir={dir}
    >
      <div className="absolute end-4 top-4 z-10">
        <LanguageToggle />
      </div>

      <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/20">
          <span className="text-3xl font-bold text-amber-400" aria-hidden>
            !
          </span>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t('title')}</h1>
          <p className="mt-2 text-sm text-slate-400">{t('desc')}</p>
        </div>

        {fawryCode && !isPaymentOverdue && !isCenterSuspended ? (
          <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 p-3 text-start">
            <p className="text-sm font-medium text-amber-300">{t('fawryCode', { code: fawryCode })}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <Link
            href="/settings/billing"
            className="rounded-xl bg-amber-500 px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-amber-400 btn-press chq-focus"
          >
            {t('payNow')}
          </Link>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-teal-800/50 px-6 py-3 text-center text-sm font-semibold text-teal-400 transition-colors hover:bg-teal-900/20 btn-press chq-focus"
          >
            {t('contactSupport')}
          </a>
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="text-sm text-slate-500 transition-colors hover:text-slate-400 btn-press chq-focus rounded-lg px-2 py-1"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
