'use client';

import { useTranslations } from 'next-intl';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

export default function WhatsAppSettingsPage() {
  const t = useTranslations('whatsapp');

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Back to Settings */}
          <Link 
            href="/settings" 
            className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-6"
          >
            ← {t('backToSettings')}
          </Link>

          {/* Main Content Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 md:p-12 text-center">
            {/* Icon */}
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center">
              <svg 
                className="w-10 h-10 text-white" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" 
                />
              </svg>
            </div>

            {/* Title */}
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-4">
              {t('title')}
            </h1>

            {/* Description */}
            <p className="text-base md:text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
              {t('contactSupport')}
            </p>

            {/* Support Contact Box */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 mb-6">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {t('supportLabel')}
              </p>
              <a 
                href="mailto:support@centerhq.com"
                className="text-xl md:text-2xl font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 break-all"
              >
                support@centerhq.com
              </a>
            </div>

            {/* WhatsApp Support (Optional) */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {/* Your CenterHQ support WhatsApp number */}
              <a
                href="https://wa.me/201001234567"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                </svg>
                {t('whatsappSupport')}
              </a>
              
              <Link
                href="/settings"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-lg transition-colors"
              >
                {t('backToSettings')}
              </Link>
            </div>

            {/* Info Note */}
            <p className="mt-8 text-xs text-gray-500 dark:text-gray-400">
              {t('responseTime')}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}