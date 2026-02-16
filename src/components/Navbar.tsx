'use client';

import { useState, useEffect } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setIsAdmin(!!data?.isAdmin);
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
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

  const roleLabelKey = user?.role === 'owner' ? 'roleOwner' : user?.role === 'admin' ? 'roleAdmin' : user?.role === 'assistant' ? 'roleAssistant' : user?.role === 'teacher' ? 'roleTeacher' : null;
  const roleBadgeClass = user?.role ? getRoleBadge(user.role) : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  const isLimitedAccess = user?.role === 'assistant';
  const centerName = user?.center?.name || user?.name || user?.phone || 'User';

  const navLink = (item: { key: string; href: string }, isMobile = false) => {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    const base = isMobile
      ? `block w-full text-start px-4 py-3 text-base font-medium rounded-lg transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`
      : `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800'}`;
    return (
      <Link key={item.key} href={item.href} className={base} onClick={() => isMobile && setMenuOpen(false)}>
        {t(item.key)}
      </Link>
    );
  };

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: Logo + Brand (mobile) or Logo + Brand + Nav (desktop) */}
          <div className="flex items-center gap-6 md:gap-8 min-w-0">
            <div className="flex-shrink-0 flex items-center gap-2">
              {user?.center?.logo_url ? (
                <img src={user.center.logo_url} alt={centerName} className="h-10 w-auto object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">CH</span>
                </div>
              )}
              <Link href="/dashboard" className="text-lg font-bold text-gray-900 dark:text-white truncate" onClick={() => setMenuOpen(false)}>
                CenterHQ
              </Link>
            </div>
            {/* Desktop nav items */}
            <div className="hidden md:flex md:gap-1 md:items-center md:min-w-0 overflow-x-auto">
              {navItems.map(item => navLink(item, false))}
            </div>
          </div>

          {/* Right: Desktop controls */}
          <div className="hidden md:flex md:items-center md:gap-3 flex-shrink-0">
              {isAdmin && (
                <Link
                  href="/admin"
                  className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border-2 transition-colors ${
                    pathname?.startsWith('/admin')
                      ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'border-red-500 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                  }`}
                >
                  {t('admin')}
                </Link>
              )}
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                  <span className="truncate max-w-[120px]">{centerName}</span>
                  {roleLabelKey && (
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`} title={`${centerName} (${t(roleLabelKey)})`}>
                      ({t(roleLabelKey)})
                    </span>
                  )}
                </span>
              </div>
            )}
            {isLimitedAccess && (
              <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" title={t('limitedAccess')}>
                {t('limitedAccess')}
              </span>
            )}
            {user && (
              <button
                onClick={handleLogout}
                className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title={t('logout')}
              >
                {t('logout')}
              </button>
            )}
            <SyncIndicator />
            <LanguageToggle />
          </div>

          {/* Mobile: Hamburger / Close */}
          <div className="flex md:hidden items-center gap-2 flex-shrink-0">
            <SyncIndicator />
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown overlay */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-x-0 top-0 z-50 md:hidden bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-lg max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center h-14 px-4 border-b border-gray-200 dark:border-gray-700">
              <span className="text-lg font-bold text-gray-900 dark:text-white">CenterHQ</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-2 py-4 space-y-1">
              {navItems.map(item => navLink(item, true))}
              {isAdmin && (
                <Link
                  href="/admin"
                  className={`block w-full text-start px-4 py-3 text-base font-medium rounded-lg border-2 transition-colors ${
                    pathname?.startsWith('/admin')
                      ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'border-red-500 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                  }`}
                  onClick={() => setMenuOpen(false)}
                >
                  {t('admin')}
                </Link>
              )}
              <hr className="my-4 border-gray-200 dark:border-gray-800" />
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{centerName}</p>
                {roleLabelKey && (
                  <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>
                    {t(roleLabelKey)}
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="block w-full text-start px-4 py-3 text-base font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                {t('logout')}
              </button>
              <div className="px-4 py-2 pt-2">
                <LanguageToggle />
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
