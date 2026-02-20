'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';

const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '201220601410';

export default function SuspendedPage() {
  const t = useTranslations('suspended');
  const locale = useLocale();

  const [fawryCode, setFawryCode] = useState('');
  const reason = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('reason') : null;
  const isCenterSuspended = reason === 'center_suspended';
  const isPaymentOverdue = reason === 'payment_overdue';

  useEffect(() => {
    if (isCenterSuspended || isPaymentOverdue) return;

    const loadSubscription = async () => {
      const { data: { session } } = await supabase.auth.getSession();
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
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--gradient-hero)' }}>
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="text-center max-w-sm">
        <div className="text-6xl mb-6">&#x1F512;</div>
        <h1 className="text-2xl font-black text-white mb-3">
          {t('title')}
        </h1>
        <p className="text-white/60 mb-8">
          {t('message')}
        </p>

        {fawryCode && !isPaymentOverdue && !isCenterSuspended && (
          <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-sm text-amber-400 font-medium">
              {t('fawryCode', { code: fawryCode })}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 rounded-xl font-bold text-white text-sm"
            style={{ background: '#25D366' }}
          >
            &#x1F4AC; {t('contactViaWhatsapp')}
          </a>
          <Link
            href="/settings/billing"
            className="px-6 py-3 rounded-xl font-bold text-sm border border-white/30 text-white hover:bg-white/10 transition-colors"
          >
            {t('goToBilling')}
          </Link>
        </div>

        <button
          onClick={handleLogout}
          className="mt-8 text-sm text-white/40 hover:text-white/60 transition-colors"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  );
}
