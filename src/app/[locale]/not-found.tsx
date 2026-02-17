import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function NotFound() {
  const t = useTranslations('nav');

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-text-primary mb-4">
            404
          </h1>
          <p className="text-xl text-text-secondary mb-8">
            Page not found
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            {t('dashboard')}
          </Link>
        </div>
    </div>
  );
}
