'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { useLayout } from '@/contexts/LayoutContext';
import type { PermissionKey, UserRole } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';
import SyncIndicator from './SyncIndicator';
import {
  LayoutDashboard,
  Users,
  ScanLine,
  CreditCard,
  BookOpen,
  DoorOpen,
  Calendar,
  Settings,
  Shield,
  Smartphone,
  Menu,
  X,
} from 'lucide-react';

const getRoleBadge = (role: UserRole | string) => {
  const badges: Record<string, string> = {
    owner: 'bg-blue-500/15 text-blue-400',
    admin: 'bg-blue-500/15 text-blue-400',
    super_admin: 'bg-red-500/15 text-red-400',
    assistant: 'bg-green-500/15 text-green-400',
    teacher: 'bg-purple-500/15 text-purple-400',
  };
  return badges[role ?? ''] || badges.assistant;
};

export default function TopNavbar() {
  const t = useTranslations('nav');
  const tRoles = useTranslations('roles');
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const { toggleMode } = useLayout();
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
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  const allNavItems: { key: string; href: string; icon: React.ReactNode; permission?: PermissionKey }[] = [
    { key: 'dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-4 h-4 shrink-0" />, permission: 'can_view_dashboard' },
    { key: 'students', href: '/students', icon: <Users className="w-4 h-4 shrink-0" />, permission: 'can_manage_students' },
    { key: 'scanner', href: '/scan', icon: <ScanLine className="w-4 h-4 shrink-0" />, permission: 'can_scan' },
    { key: 'payments', href: '/payments', icon: <CreditCard className="w-4 h-4 shrink-0" />, permission: 'can_view_payments' },
    { key: 'groups', href: '/groups', icon: <BookOpen className="w-4 h-4 shrink-0" />, permission: 'can_manage_groups' },
    { key: 'rooms', href: '/rooms', icon: <DoorOpen className="w-4 h-4 shrink-0" />, permission: 'can_manage_rooms' },
    { key: 'schedule', href: '/schedule', icon: <Calendar className="w-4 h-4 shrink-0" />, permission: 'can_view_schedule' },
    { key: 'settings', href: '/settings', icon: <Settings className="w-4 h-4 shrink-0" />, permission: 'can_view_settings' },
  ];

  const isSuperAdminOnly = isAdmin && !user?.center_id;
  const navItems = isSuperAdminOnly
    ? []
    : user
      ? allNavItems.filter(item => {
          if (user.role === 'owner' || user.role === 'admin') return true;
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
  const roleBadgeClass = user?.role ? getRoleBadge(user.role) : 'bg-[var(--color-surface-0)]0/15 text-slate-400';
  const isLimitedAccess = user?.role === 'assistant';
  const centerName = user?.center?.name || user?.name || user?.phone || 'User';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
    <nav
      className="fixed top-0 inset-x-0 z-40 flex items-center justify-between h-14 px-4 gap-2 print:hidden"
      style={{
        background: 'var(--glass-bg, rgba(15, 23, 42, 0.6))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
      }}
    >
      {/* Start: Hamburger (mobile only) / Logo + Brand */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(o => !o)}
          className="md:hidden p-2 rounded-lg text-[var(--text-primary)] hover:bg-[var(--color-surface-1)]/5"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
        {user?.center?.logo_url ? (
          <img src={user.center.logo_url} alt={centerName} className="h-8 w-8 rounded-lg object-contain" />
        ) : (
          <Image src="/logo-icon.png" alt="CenterHQ" width={32} height={32} className="w-8 h-8 rounded-lg shrink-0 object-contain" />
        )}
        <Link href={isSuperAdminOnly ? '/admin' : '/dashboard'} className="text-base font-bold text-[var(--text-primary)] truncate hidden sm:inline">
          CenterHQ
        </Link>
      </div>

      {/* Center: Nav items (hidden on mobile) - admin-only for super admins */}
      <div className="hidden md:flex flex-1 items-center justify-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
        {isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`inline-flex items-center gap-1.5 px-2 py-2 text-xs font-medium rounded-md transition-all duration-200 whitespace-nowrap shrink-0 ${pathname?.startsWith('/admin') ? 'bg-red-500/20 text-red-400 border-b-2 border-red-400' : 'text-red-400 hover:bg-red-500/10'}`}
          >
            <Shield className="w-4 h-4 shrink-0" />
            {t('admin')}
          </Link>
        )}
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`inline-flex items-center gap-1.5 px-2 py-2 text-xs font-medium rounded-md transition-all duration-200 whitespace-nowrap shrink-0 ${isActive ? 'bg-teal-500/20 text-teal-300 border-b-2 border-teal-400' : 'text-[var(--text-secondary)] hover:bg-[var(--color-surface-1)]/5 hover:text-[var(--text-primary)]'}`}
            >
              {item.icon}
              {t(item.key)}
            </Link>
          );
        })}
        {isAdmin && !isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`inline-flex items-center gap-1.5 px-2 py-2 text-xs font-medium rounded-md transition-all duration-200 whitespace-nowrap shrink-0 ${pathname?.startsWith('/admin') ? 'bg-red-500/20 text-red-400 border-b-2 border-red-400' : 'text-red-400 hover:bg-red-500/10'}`}
          >
            <Shield className="w-4 h-4 shrink-0" />
            {t('admin')}
          </Link>
        )}
      </div>

      {/* End: Center name, role, theme, language, app mode toggle, logout (hidden on mobile) */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        {user && (
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] truncate max-w-[80px]">{centerName}</span>
            {roleLabelText && (
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>
                {roleLabelText}
              </span>
            )}
          </div>
        )}
        {isLimitedAccess && (
          <span className="hidden md:inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-500/15 text-amber-400">
            {t('limitedAccess')}
          </span>
        )}
        <ThemeToggle />
        <LanguageToggle />
        <SyncIndicator />
        <button
          type="button"
          onClick={toggleMode}
          className="p-2 rounded-lg text-[var(--text-primary)] hover:bg-[var(--color-surface-1)]/5 transition-colors"
          title={t('switchToAppMode')}
          aria-label={t('switchToAppMode')}
        >
          <Smartphone className="w-5 h-5" />
        </button>
        {user && (
          <button
            onClick={handleLogout}
            className="text-sm text-red-400 hover:bg-red-500/10 px-2 py-1 rounded-lg transition-colors"
            title={t('logout')}
          >
            {t('logout')}
          </button>
        )}
      </div>
    </nav>

    {/* Mobile drawer */}
    {mobileMenuOpen && (
      <>
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileMenuOpen(false)} aria-hidden />
        <div
          className="fixed top-14 start-0 end-0 z-50 md:hidden max-h-[calc(100vh-3.5rem)] overflow-y-auto glass rounded-b-2xl mx-2 p-4 space-y-4"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
        >
          <div className="flex flex-col gap-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${isActive ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--text-primary)] hover:bg-[var(--color-surface-1)]/5'}`}
                >
                  {item.icon}
                  {t(item.key)}
                </Link>
              );
            })}
            {(isAdmin || isSuperAdminOnly) && (
              <Link
                href="/admin"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${pathname?.startsWith('/admin') ? 'bg-red-500/20 text-red-400' : 'text-red-400 hover:bg-red-500/10'}`}
              >
                <Shield className="w-4 h-4" />
                {t('admin')}
              </Link>
            )}
          </div>
          <div className="border-t border-white/10 pt-4 space-y-3">
            {user && (
              <div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{centerName}</p>
                {roleLabelText && (
                  <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>
                    {roleLabelText}
                  </span>
                )}
              </div>
            )}
            {isLimitedAccess && (
              <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-500/15 text-amber-400">
                {t('limitedAccess')}
              </span>
            )}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle />
              <SyncIndicator />
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); toggleMode(); }}
                className="p-2 rounded-lg text-[var(--text-primary)] hover:bg-[var(--color-surface-1)]/5"
                title={t('switchToAppMode')}
              >
                <Smartphone className="w-5 h-5" />
              </button>
            </div>
            {user && (
              <button
                onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                className="w-full text-start px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg"
              >
                {t('logout')}
              </button>
            )}
          </div>
        </div>
      </>
    )}
    </>
  );
}
