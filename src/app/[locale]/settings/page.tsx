import { useTranslations } from 'next-intl';
import Navbar from '@/components/Navbar';

export default function SettingsPage() {
  const t = useTranslations('nav');
  
  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('settings')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Settings page with full RTL and i18n support.
          </p>
        </div>
      </div>
    </>
  );
}
