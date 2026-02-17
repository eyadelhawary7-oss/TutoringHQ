import { useTranslations } from 'next-intl';

export default function ScannerPage() {
  const t = useTranslations('nav');
  
  return (
    <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-text-primary mb-6">
            {t('scanner')}
          </h1>
          <p className="text-text-secondary">
            Scanner page with internationalization support.
          </p>
        </div>
    </div>
  );
}
