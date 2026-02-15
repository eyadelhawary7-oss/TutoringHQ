'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import LanguageToggle from './LanguageToggle';
import SyncIndicator from './SyncIndicator';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey, UserRole } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';

const getRoleBadge = (role: UserRole) => {
  const badges = {
    owner: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    assistant: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    teacher: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };
  return badges[role] || badges.assistant;
};

export default function Navbar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission } = useUser();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  const allNavItems: { key: string; href: string; permission?: PermissionKey }[] = [
    { key: 'dashboard', href: '/dashboard', permission: 'can_view_dashboard' },
    { key: 'students', href: '/students', permission: 'can_manage_students' },
    { key: 'scanner', href: '/scan', permission: 'can_scan' },
    { key: 'payments', href: '/payments', permission: 'can_view_payments' },
    { key: 'groups', href: '/groups', permission: 'can_manage_groups' },
    { key: 'rooms', href: '/rooms', permission: 'can_manage_rooms' },
    { key: 'schedule', href: '/schedule', permission: 'can_view_schedule' },
    { key: 'settings', href: '/settings', permission: 'can_view_settings' },
  ];

  const navItems = user
    ? allNavItems.filter(item => {
        if (user.role === 'owner' || user.role === 'admin') return true;
        if (!item.permission) return true;
        return hasPermission(item.permission);
      })
    : [];

  const roleLabelKey = user?.role === 'owner' ? 'roleOwner' : user?.role === 'admin' ? 'roleAdmin' : user?.role === 'assistant' ? 'roleAssistant' : null;
  const roleBadgeClass = user?.role ? getRoleBadge(user.role) : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  const isLimitedAccess = user?.role === 'assistant';

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
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                  <span className="hidden md:inline">{user.name || user.phone || 'User'}</span>
                  {roleLabelKey && (
                    <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`} title={`${user.name || user.phone || 'User'} (${t(roleLabelKey)})`}>
                      <span className="hidden md:inline">({t(roleLabelKey)})</span>
                      <span className="md:hidden">{t(roleLabelKey).slice(0, 1)}</span>
                    </span>
                  )}
                </span>
              </div>
            )}
            {isLimitedAccess && (
              <span className="hidden sm:inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" title={t('limitedAccess')}>
                {t('limitedAccess')}
              </span>
            )}
            {user && (
              <button
                onClick={handleLogout}
                className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title={t('logout', { defaultValue: 'Logout' })}
              >
                {t('logout', { defaultValue: 'Logout' })}
              </button>
            )}
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
