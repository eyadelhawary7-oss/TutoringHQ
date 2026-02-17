'use client';

import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';
import ThemeToggle from '@/components/ThemeToggle';
import { QrCode, CreditCard, Calendar, BarChart3, WifiOff, Bluetooth, Check, Languages } from 'lucide-react';
import { toAr } from '@/lib/number-utils';

const TOP_CENTERS_WHATSAPP = 'https://wa.me/201220601410?text=مرحباً، أنا مهتم بخطة كبار السناتر لأكثر من 2000 طالب أسبوعياً';

const LANDING_PLANS = [
  {
    id: 'starter',
    nameKey: 'planStarter' as const,
    price: 2000,
    setupFee: 1000,
    features: ['pricingStarter1', 'pricingStarter2', 'pricingStarter3', 'pricingStarter4', 'pricingStarter5', 'pricingStarter6', 'pricingStarter7', 'pricingStarter8', 'pricingStarter9', 'pricingStarter10'] as const,
    highlighted: false,
    isCustom: false,
    ctaKey: 'choosePlan' as const,
    href: '/signup',
    external: false,
  },
  {
    id: 'pro',
    nameKey: 'planPro' as const,
    price: 4500,
    setupFee: 2000,
    features: ['pricingPro1', 'pricingPro2', 'pricingPro3', 'pricingPro4', 'pricingPro5', 'pricingPro6', 'pricingPro7', 'pricingPro8', 'pricingPro9', 'pricingPro10'] as const,
    highlighted: true,
    isCustom: false,
    ctaKey: 'choosePlan' as const,
    href: '/signup',
    external: false,
  },
  {
    id: 'business',
    nameKey: 'planBusiness' as const,
    price: 6500,
    setupFee: 3000,
    features: ['pricingBusiness1', 'pricingBusiness2', 'pricingBusiness3', 'pricingBusiness4', 'pricingBusiness5', 'pricingBusiness6', 'pricingBusiness7', 'pricingBusiness8'] as const,
    highlighted: false,
    isCustom: false,
    ctaKey: 'choosePlan' as const,
    href: '/signup',
    external: false,
  },
  {
    id: 'enterprise',
    nameKey: 'planEnterprise' as const,
    price: 9000,
    setupFee: 5000,
    features: ['pricingEnterprise1', 'pricingEnterprise2', 'pricingEnterprise3', 'pricingEnterprise4', 'pricingEnterprise5', 'pricingEnterprise6', 'pricingEnterprise7'] as const,
    highlighted: false,
    isCustom: false,
    ctaKey: 'choosePlan' as const,
    href: '/signup',
    external: false,
  },
  {
    id: 'top_centers',
    nameKey: 'planTopCenters' as const,
    price: null,
    setupFee: null,
    features: ['pricingTopCenters1', 'pricingTopCenters2', 'pricingTopCenters3', 'pricingTopCenters4', 'pricingTopCenters5', 'pricingTopCenters6', 'pricingTopCenters7'] as const,
    highlighted: false,
    isCustom: true,
    ctaKey: 'contactUs' as const,
    href: TOP_CENTERS_WHATSAPP,
    external: true,
  },
] as const;

const FEATURE_CARDS = [
  { key: 'featureQRAttendance', descKey: 'featureQRAttendanceDesc', icon: QrCode },
  { key: 'featurePaymentTracking', descKey: 'featurePaymentTrackingDesc', icon: CreditCard },
  { key: 'featureScheduling', descKey: 'featureSchedulingDesc', icon: Calendar },
  { key: 'featureAnalytics', descKey: 'featureAnalyticsDesc', icon: BarChart3 },
  { key: 'featureOfflineSupport', descKey: 'featureOfflineSupportDesc', icon: WifiOff },
  { key: 'featureBluetoothScanner', descKey: 'featureBluetoothScannerDesc', icon: Bluetooth },
] as const;

export default function LandingPage() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const isAr = locale === 'ar';

  const formatNum = (n: number) => (isAr ? toAr(n) : n.toLocaleString());

  return (
    <div className="min-h-screen bg-white" data-theme="light">
      {/* Fixed white navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-icon.png" alt="CenterHQ" width={36} height={36} className="w-9 h-9" />
            <span className="text-lg font-semibold text-text-primary">CenterHQ</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-text-secondary">
              <div className="flex items-center gap-1.5">
                <Languages className="w-5 h-5 text-text-secondary" aria-hidden />
                <LanguageToggle />
              </div>
              <ThemeToggle />
            </div>
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg border border-gray-300 text-text-primary font-medium hover:bg-gray-50 transition-colors"
            >
              {t('loginButton')}
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
            >
              {t('signupButton')}
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-[60px]">
        {/* Hero section */}
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 text-text-primary text-sm mb-8 rtl:flex-row-reverse">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              {t('heroBadge')}
            </div>
            <h1 className="text-5xl font-bold text-text-primary mb-4">
              {t('heroTitle1')}
              <br />
              <span className="text-indigo-600">{t('heroTitle2')}</span>
            </h1>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto mb-10">
              {t('heroSubtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
              >
                {t('ctaStartNow')}
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center px-8 py-3 rounded-lg border border-gray-300 text-text-primary font-medium hover:bg-gray-50 transition-colors"
              >
                {t('ctaExploreDashboard')}
              </Link>
            </div>
          </div>
        </section>

        {/* Features section */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50/50">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-text-primary text-center mb-4">
              {t('featuresHeading')}
            </h2>
            <p className="text-text-secondary text-center mb-12">
              {t('featuresSubtitle')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURE_CARDS.map(({ key, descKey, icon: Icon }) => (
                <div
                  key={key}
                  className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="inline-flex p-2 rounded-lg bg-indigo-50 text-indigo-600 mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-text-primary mb-2">{t(key)}</h3>
                  <p className="text-text-secondary">{t(descKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing section */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-text-primary text-center mb-4">
              {t('pricingHeading')}
            </h2>
            <p className="text-text-secondary text-center mb-12">
              {t('pricingSubtitle')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              {LANDING_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`bg-white rounded-xl border p-6 lg:p-8 ${
                    plan.highlighted ? 'border-2 border-indigo-600 shadow-lg relative' : 'border-gray-200'
                  }`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-block px-3 py-1 rounded-full bg-indigo-600 text-white text-xs font-medium">
                        {t('mostPopular')}
                      </span>
                    </div>
                  )}
                  <h3 className="text-xl font-bold text-text-primary mb-4">{t(plan.nameKey)}</h3>
                  <div className="flex items-baseline gap-1 mb-2">
                    {plan.price !== null ? (
                      <>
                        <span className="text-4xl font-bold text-text-primary tabular-nums">
                          {formatNum(plan.price)}
                        </span>
                        <span className="text-text-secondary">{t('perMonth')}</span>
                      </>
                    ) : (
                      <span className="text-2xl font-bold text-indigo-600">{t('custom')}</span>
                    )}
                  </div>
                  {'setupFee' in plan && (
                    plan.setupFee != null ? (
                      <p className="text-sm text-text-secondary mb-4">{t('setupFee', { amount: formatNum(plan.setupFee) })}</p>
                    ) : plan.isCustom ? (
                      <p className="text-sm text-text-secondary mb-4">{t('setupFeeCustom', { defaultValue: 'Setup: Custom (EGP 10K-25K)' })}</p>
                    ) : null
                  )}
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((fk) => (
                      <li key={fk} className="flex items-center gap-2 text-text-secondary">
                        <Check className="w-5 h-5 text-green-500 shrink-0" />
                        <span>{t(fk)}</span>
                      </li>
                    ))}
                  </ul>
                  {plan.external ? (
                    <a
                      href={plan.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center py-3 rounded-lg font-medium border border-gray-300 text-text-primary hover:bg-gray-50 transition-colors"
                    >
                      {t(plan.ctaKey)}
                    </a>
                  ) : (
                    <Link
                      href={plan.href}
                      className={`block w-full text-center py-3 rounded-lg font-medium transition-colors ${
                        plan.highlighted
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'border border-gray-300 text-text-primary hover:bg-gray-50'
                      }`}
                    >
                      {t(plan.ctaKey)}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-gray-200">
          <p className="text-center text-text-tertiary text-sm">{t('footer')}</p>
        </footer>
      </main>
    </div>
  );
}
