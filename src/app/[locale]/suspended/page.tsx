'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import LanguageToggle from '@/components/LanguageToggle';

export default function SuspendedPage() {
  const t = useTranslations('suspended');

  const [fawryCode, setFawryCode] = useState('');

  useEffect(() => {
    const loadSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (!userRecord) return;

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('fawry_reference')
        .eq('center_id', userRecord.center_id)
        .single();

      if (subscription?.fawry_reference) {
        setFawryCode(subscription.fawry_reference);
      }
    };
    loadSubscription();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-red-100 dark:from-gray-900 dark:via-red-950 dark:to-gray-900">
      {/* Language Toggle */}
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          {/* Icon */}
          <div className="w-20 h-20 mx-auto bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            {t('title')}
          </h1>

          {/* Message */}
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('message')}
          </p>

          {/* Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 space-y-4">
            {/* Fawry Code */}
            {fawryCode && (
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <p className="text-sm text-orange-700 dark:text-orange-400 font-medium">
                  {t('fawryCode', { code: fawryCode })}
                </p>
              </div>
            )}

            {/* Renew Button */}
            <a
              href="https://wa.me/201234567890?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AA%D8%AC%D8%AF%D9%8A%D8%AF%20%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83%D9%8A"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors text-center"
            >
              {t('renewButton')}
            </a>

            {/* WhatsApp Contact */}
            <a
              href="https://wa.me/201234567890"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 px-4 border border-green-600 text-green-600 dark:text-green-400 font-medium rounded-lg hover:bg-green-50 dark:hover:bg-green-950 transition-colors text-center"
            >
              {t('whatsapp')}
            </a>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="mt-6 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {t('contactUs')}
          </button>
        </div>
      </div>
    </div>
  );
}
