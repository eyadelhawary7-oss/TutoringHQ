import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';

export default function LandingPage() {
  const t = useTranslations('landing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900">
      {/* Language Toggle - Top Corner */}
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl w-full text-center space-y-8">
          {/* Logo/Brand Section */}
          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-white">
              CenterHQ
            </h1>
            <p className="text-3xl sm:text-4xl font-semibold text-indigo-600 dark:text-indigo-400">
              {t('subtitle')}
            </p>
          </div>

          {/* Tagline */}
          <div className="space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200">
              {t('tagline')}
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
              {t('description')}
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-8">
            <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 shadow-md">
              <div className="text-3xl mb-2">📊</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">{t('featureStudents')}</p>
            </div>
            <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 shadow-md">
              <div className="text-3xl mb-2">💰</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">{t('featurePayments')}</p>
            </div>
            <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 shadow-md">
              <div className="text-3xl mb-2">📅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">{t('featureSchedule')}</p>
            </div>
          </div>

          {/* CTA Button */}
          <div className="pt-6">
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-4 text-xl font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
            >
              {t('loginButton')}
              <svg
                className="w-6 h-6 ms-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                />
              </svg>
            </Link>
          </div>

          {/* Footer Note */}
          <div className="pt-12">
            <p className="text-sm text-gray-500 dark:text-gray-500">
              {t('footer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
