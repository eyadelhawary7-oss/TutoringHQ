import { useTranslations } from 'next-intl';
import LanguageToggle from './LanguageToggle';
import { Link } from '@/i18n/routing';

export default function Navbar() {
  const t = useTranslations('nav');

  const navItems = [
    { key: 'dashboard', href: '/dashboard' },
    { key: 'students', href: '/students' },
    { key: 'scanner', href: '/scanner' },
    { key: 'payments', href: '/payments' },
    { key: 'schedule', href: '/schedule' },
    { key: 'messages', href: '/messages' },
    { key: 'settings', href: '/settings' },
  ] as const;

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-8">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-gray-900 dark:text-white">
                CenterHQ
              </span>
            </div>
            <div className="hidden sm:flex sm:gap-4">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors"
                >
                  {t(item.key)}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center">
            <LanguageToggle />
          </div>
        </div>
      </div>
    </nav>
  );
}
