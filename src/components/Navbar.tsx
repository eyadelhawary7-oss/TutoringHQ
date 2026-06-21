'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import LanguageToggle from './LanguageToggle';
import SyncIndicator from './SyncIndicator';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey, UserRole } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

const getRoleBadge = (role: UserRole | string) => {
  const badges: Record<string, string> = {
    owner: 'bg-blue-100 text-blue-800',
    admin: 'bg-blue-100 text-blue-800',
    super_admin: 'bg-red-100 text-red-800',
    assistant: 'bg-green-100 text-green-800',
    teacher: 'bg-purple-100 text-purple-800',
  };
  return badges[role ?? ''] || badges.assistant;
};

export default function Navbar() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const tRoles = useTranslations('roles');
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
    await signOutToLogin(locale);
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

  const isSuperAdminOnly = isAdmin && !user?.center_id;
  const navItems = isSuperAdminOnly
    ? []
    : user
      ? allNavItems.filter(item => {
          if (user.role === 'owner' || user.role === 'admin' || user.role === 'super_admin') return true;
          if (!item.permission) return true;
          return hasPermission(item.permission);
        })
      : [];

  const roleLabelText =
    user?.role && ['owner', 'admin', 'assistant', 'teacher', 'super_admin'].includes(user.role)
      ? tRoles(user.role as 'owner' | 'admin' | 'assistant' | 'teacher' | 'super_admin')
      : isSuperAdminOnly
        ? tRoles('super_admin')
        : null;
  const roleBadgeClass = user?.role ? getRoleBadge(user.role) : 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]';
  const isLimitedAccess = user?.role === 'assistant';
  const centerName = user?.center?.name || user?.name || user?.phone || 'User';

  const navLink = (item: { key: string; href: string }, isMobile = false) => {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    const base = isMobile
      ? `block w-full text-start px-4 py-3 text-base font-medium rounded-lg transition-colors ${isActive ? 'bg-teal-50 text-teal-700' : 'text-text-primary hover:bg-bg-secondary'}`
      : `inline-flex items-center px-2 py-2 text-xs lg:text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-shrink-0 ${isActive ? 'bg-teal-50 text-teal-700' : 'text-text-primary hover:text-text-primary hover:bg-bg-secondary'}`;
    return (
      <Link key={item.key} href={item.href} className={base} onClick={() => isMobile && setMenuOpen(false)}>
        {t(item.key)}
      </Link>
    );
  };

  return (
    <nav className="bg-bg-primary border-b border-[var(--color-border-subtle)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: Logo + Brand */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {user?.center?.logo_url ? (
              <img src={user.center.logo_url} alt={centerName} className="h-10 w-auto object-contain" />
            ) : null}
            <Link href={isSuperAdminOnly ? '/admin' : '/dashboard'} className="text-lg font-bold text-text-primary truncate" onClick={() => setMenuOpen(false)}>
              TutoringHQ
            </Link>
          </div>

          {/* Center: Desktop nav items (no overflow, no scrollbar) - hidden for super admins */}
          <div className="hidden md:flex md:flex-1 md:items-center md:justify-center md:gap-1 md:flex-nowrap">
            {navItems.map(item => navLink(item, false))}
            {isSuperAdminOnly && (
              <Link
                href="/admin"
                className={`inline-flex items-center px-2 py-2 text-xs lg:text-sm font-medium rounded-md border-2 transition-colors whitespace-nowrap flex-shrink-0 ${pathname?.startsWith('/admin') ? 'border-red-500 bg-red-50 text-red-700' : 'border-red-500 text-red-600 hover:bg-red-50'}`}
              >
                {t('admin')}
              </Link>
            )}
          </div>

          {/* Right: Center name + role badge + language toggle */}
          <div className="hidden md:flex md:items-center md:gap-2 flex-shrink-0">
              {isAdmin && !isSuperAdminOnly && (
                <Link
                  href="/admin"
                  className={`inline-flex items-center px-2 py-2 text-xs lg:text-sm font-medium rounded-md border-2 transition-colors whitespace-nowrap flex-shrink-0 ${pathname?.startsWith('/admin') ? 'border-red-500 bg-red-50 text-red-700' : 'border-red-500 text-red-600 hover:bg-red-50'}`}
                >
                  {t('admin')}
                </Link>
              )}
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-xs lg:text-sm text-text-secondary flex items-center gap-1.5">
                  <span className="truncate max-w-[100px]">{centerName}</span>
                  {roleLabelText && (
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`} title={`${centerName} (${roleLabelText})`}>
                      ({roleLabelText})
                    </span>
                  )}
                </span>
              </div>
            )}
            {isLimitedAccess && (
              <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-600" title={t('limitedAccess')}>
                {t('limitedAccess')}
              </span>
            )}
            {user && (
              <button
                onClick={handleLogout}
                className="text-sm text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
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
              className="p-2 rounded-lg text-text-secondary hover:bg-bg-secondary"
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
          <div className="fixed start-0 end-0 top-0 z-50 md:hidden bg-bg-primary border-b border-[var(--color-border-subtle)] shadow-lg max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center h-14 px-4 border-b border-[var(--color-border-subtle)]">
              <span className="text-lg font-bold text-text-primary">TutoringHQ</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-2 rounded-lg text-text-secondary hover:bg-bg-secondary"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-2 py-4 space-y-1">
              {navItems.map(item => navLink(item, true))}
              {(isAdmin || isSuperAdminOnly) && (
                <Link
                  href="/admin"
                  className={`block w-full text-start px-4 py-3 text-base font-medium rounded-lg border-2 transition-colors ${pathname?.startsWith('/admin') ? 'border-red-500 bg-red-50 text-red-700' : 'border-red-500 text-red-600 hover:bg-red-50'}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {t('admin')}
                </Link>
              )}
              <hr className="my-4 border-[var(--color-border-subtle)]" />
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-text-primary truncate">{centerName}</p>
                {roleLabelText && (
                  <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>
                    {roleLabelText}
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="block w-full text-start px-4 py-3 text-base font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
