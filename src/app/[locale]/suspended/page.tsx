'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import LanguageToggle from '@/components/LanguageToggle';

const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '201234567890';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@centerhq.com';

export default function SuspendedPage() {
  const t = useTranslations('suspended');
  const router = useRouter();

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
        headers: { 'Authorization': `Bearer ${session.access_token}` },
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
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const waMessage = isPaymentOverdue
    ? t('paymentOverdueWhatsapp', { defaultValue: 'أريد سداد اشتراك CenterHQ' })
    : isCenterSuspended
      ? t('centerSuspendedWhatsappMessage')
      : t('whatsappMessage');
  const waHref = `https://wa.me/201220601410?text=${encodeURIComponent(waMessage)}`;

  if (isPaymentOverdue) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-red-100 dark:from-gray-900 dark:via-red-950 dark:to-gray-900">
        <div className="absolute top-4 end-4 z-10">
          <LanguageToggle />
        </div>
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-3">{t('overdue', { defaultValue: 'Account Suspended' })}</h1>
            <p className="text-text-secondary mb-6">{t('overdueMessage', { defaultValue: 'تم إيقاف حسابك بسبب تأخر السداد. للتجديد تواصل معنا' })}</p>
            <div className="space-y-3">
              <button
                onClick={() => router.push('/settings/billing')}
                className="w-full py-3 px-6 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors"
              >
                {t('payNow', { defaultValue: 'Pay Now' })}
              </button>
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 w-full py-3 px-6 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                {t('contactUs')}
              </a>
            </div>
            <button onClick={handleLogout} className="mt-6 text-sm text-text-secondary hover:text-text-primary">{t('logout')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (isCenterSuspended) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-red-100 dark:from-gray-900 dark:via-red-950 dark:to-gray-900">
        <div className="absolute top-4 end-4 z-10">
          <LanguageToggle />
        </div>

        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-text-primary mb-3">
              {t('centerSuspendedTitle')}
            </h1>

            <p className="text-text-secondary mb-6">
              {t('centerSuspendedMessage')}
            </p>

            <div className="bg-bg-primary rounded-2xl shadow-xl p-6 space-y-4">
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors text-center"
              >
                {t('whatsapp')}
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="block w-full py-3 px-4 border border-indigo-600 text-indigo-600 dark:text-indigo-400 font-medium rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors text-center"
              >
                {t('contactUs')}
              </a>
            </div>

            <button
              onClick={handleLogout}
              className="mt-6 text-sm text-text-secondary hover:text-text-primary"
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-red-100 dark:from-gray-900 dark:via-red-950 dark:to-gray-900">
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-text-primary mb-3">
            {t('title')}
          </h1>

          <p className="text-text-secondary mb-6">
            {t('message')}
          </p>

          <div className="bg-bg-primary rounded-2xl shadow-xl p-6 space-y-4">
            {fawryCode && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <p className="text-sm text-orange-700 dark:text-orange-400 font-medium">
                  {t('fawryCode', { code: fawryCode })}
                </p>
              </div>
            )}

            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors text-center"
            >
              {t('renewButton')}
            </a>

            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 px-4 border border-green-600 text-green-600 dark:text-green-400 font-medium rounded-lg hover:bg-green-50 dark:hover:bg-green-950 transition-colors text-center"
            >
              {t('whatsapp')}
            </a>
          </div>

          <button
            onClick={handleLogout}
            className="mt-6 text-sm text-text-secondary hover:text-text-primary"
          >
            {t('logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
