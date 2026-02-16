'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';
import { toAr } from '@/lib/number-utils';

const PLANS = [
  { id: 'starter', monthlyFee: 4000, limit: 200, setupFee: 2500 },
  { id: 'pro', monthlyFee: 7200, limit: 600, setupFee: 5000, mostPopular: true },
  { id: 'pro_plus', monthlyFee: 8000, limit: 1000, setupFee: 7500 },
  { id: 'enterprise', monthlyFee: 9000, limit: 1500, setupFee: 10000 },
  { id: 'top_centers', limit: 1500, isCustom: true },
] as const;

const FEATURES = [
  { key: 'featureQRAttendance', descKey: 'featureQRAttendanceDesc', icon: '📷' },
  { key: 'featurePayments', descKey: 'featurePaymentsDesc', icon: '💳' },
  { key: 'featureScheduling', descKey: 'featureSchedulingDesc', icon: '📅' },
  { key: 'featureAnalytics', descKey: 'featureAnalyticsDesc', icon: '📊' },
  { key: 'featureOffline', descKey: 'featureOfflineDesc', icon: '📴' },
  { key: 'featureBluetooth', descKey: 'featureBluetoothDesc', icon: '🔗' },
] as const;

export default function LandingPage() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const isAr = locale === 'ar';

  const formatNum = (n: number) => (isAr ? toAr(n) : n.toLocaleString());
  const PLAN_NAME_KEYS: Record<string, 'planStarter' | 'planPro' | 'planProPlus' | 'planEnterprise' | 'planTopCenters'> = {
    starter: 'planStarter',
    pro: 'planPro',
    pro_plus: 'planProPlus',
    enterprise: 'planEnterprise',
    top_centers: 'planTopCenters',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-2xl w-full flex flex-col items-center">
          {/* Header: Logo + Heading (once) + Subheading */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <span className="text-2xl font-bold text-white">CH</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-3">
              CenterHQ
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-xl mx-auto">
              {t('description')}
            </p>
          </div>

          {/* Feature Grid: 2×3 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mb-10">
            {FEATURES.map((f) => (
              <div
                key={f.key}
                className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-xl p-4 shadow-md border border-gray-200/50 dark:border-gray-700/50"
              >
                <div className="text-2xl mb-2">{f.icon}</div>
                <p className="text-gray-900 dark:text-white font-medium">{t(f.key)}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{t(f.descKey)}</p>
              </div>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-14">
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-lg hover:shadow-xl transition-all w-full sm:w-auto"
            >
              {t('loginButton')}
              <svg className="w-5 h-5 ms-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m4 4H5" />
              </svg>
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-8 py-3.5 text-lg font-medium text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800 border-2 border-indigo-600 dark:border-indigo-500 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors w-full sm:w-auto"
            >
              {t('signupButton')}
            </Link>
          </div>

          {/* Pricing Section */}
          <div className="w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">
              {t('pricingTitle')}
            </h2>
            <div className="space-y-4">
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-xl p-4 border bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm ${
                    'mostPopular' in plan && plan.mostPopular
                      ? 'border-indigo-500 dark:border-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {'mostPopular' in plan && plan.mostPopular && (
                    <div className="flex justify-center mb-2">
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-indigo-500/20 dark:bg-indigo-400/20 text-indigo-700 dark:text-indigo-300">
                        {t('mostPopular')}
                      </span>
                    </div>
                  )}
                  <p className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                    {t(PLAN_NAME_KEYS[plan.id])}
                  </p>
                  {'isCustom' in plan && plan.isCustom ? (
                    <>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t('topCentersLimit')}
                      </p>
                      <p className="text-indigo-600 dark:text-indigo-400 font-medium mt-1">
                        {t('custom')}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="flex items-baseline gap-1">
                        <span
                          className="text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums"
                          style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                        >
                          {formatNum('monthlyFee' in plan ? plan.monthlyFee : 0)}
                        </span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('perMonth')}</span>
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {t('studentsLimit', { count: formatNum(plan.limit) })}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                        {t('setupFee', { amount: formatNum('setupFee' in plan ? plan.setupFee : 0) })}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-14 pt-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('footer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
