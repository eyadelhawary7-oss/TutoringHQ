'use client';

import { useTranslations } from 'next-intl';
import LanguageToggle from './LanguageToggle';
import SyncIndicator from './SyncIndicator';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';

export default function Navbar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user, hasPermission } = useUser();

  const allNavItems: { key: string; href: string; roles: string[]; permission?: string }[] = [
    { key: 'dashboard', href: '/dashboard', roles: ['owner', 'admin', 'assistant', 'teacher'] },
    { key: 'students', href: '/students', roles: ['owner', 'admin'] },
    { key: 'scanner', href: '/scan', roles: ['owner', 'admin', 'assistant', 'teacher'] },
    { key: 'payments', href: '/payments', roles: ['owner', 'admin', 'assistant'], permission: 'can_manage_payments' },
    { key: 'groups', href: '/groups', roles: ['owner', 'admin', 'assistant'], permission: 'can_send_whatsapp' },
    { key: 'messages', href: '/messages', roles: ['owner', 'admin', 'assistant'], permission: 'can_send_whatsapp' },
    { key: 'rooms', href: '/rooms', roles: ['owner', 'admin'] },
    { key: 'schedule', href: '/schedule', roles: ['owner', 'admin', 'assistant', 'teacher'], permission: 'can_view_calendar' },
    { key: 'settings', href: '/settings', roles: ['owner', 'admin'] },
  ];

  // Filter nav items: role must match, and for assistants/teachers check permission if required
  const navItems = user
    ? allNavItems.filter(item => {
        if (!item.roles.includes(user.role)) return false;
        if (item.permission && (user.role === 'assistant' || user.role === 'teacher')) {
          return hasPermission(item.permission as 'can_manage_payments' | 'can_send_whatsapp' | 'can_view_calendar');
        }
        return true;
      })
    : allNavItems;

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-8">
            <div className="flex-shrink-0 flex items-center gap-2">
              {user?.center?.logo_url ? (
                <img
                  src={user.center.logo_url}
                  alt={user.center.name || 'Center'}
                  className="h-10 w-auto object-contain"
                />
              ) : null}
              <Link href="/dashboard" className="text-xl font-bold text-gray-900 dark:text-white">
                CenterHQ
              </Link>
            </div>
            <div className="hidden sm:flex sm:gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                        : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {t(item.key)}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <SyncIndicator />
            <LanguageToggle />
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden border-t border-gray-200 dark:border-gray-800">
        <div className="flex overflow-x-auto gap-1 px-2 py-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex-shrink-0 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
