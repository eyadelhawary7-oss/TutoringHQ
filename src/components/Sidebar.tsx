'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLayout } from '@/contexts/LayoutContext';
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
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
  Menu,
  X,
  Monitor,
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

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations('nav');
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
    onClose?.();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  const allNavItems: { key: string; href: string; icon: React.ReactNode; permission?: PermissionKey }[] = [
    { key: 'dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-5 h-5 shrink-0" />, permission: 'can_view_dashboard' },
    { key: 'students', href: '/students', icon: <Users className="w-5 h-5 shrink-0" />, permission: 'can_manage_students' },
    { key: 'scanner', href: '/scan', icon: <ScanLine className="w-5 h-5 shrink-0" />, permission: 'can_scan' },
    { key: 'payments', href: '/payments', icon: <CreditCard className="w-5 h-5 shrink-0" />, permission: 'can_view_payments' },
    { key: 'groups', href: '/groups', icon: <BookOpen className="w-5 h-5 shrink-0" />, permission: 'can_manage_groups' },
    { key: 'rooms', href: '/rooms', icon: <DoorOpen className="w-5 h-5 shrink-0" />, permission: 'can_manage_rooms' },
    { key: 'schedule', href: '/schedule', icon: <Calendar className="w-5 h-5 shrink-0" />, permission: 'can_view_schedule' },
    { key: 'settings', href: '/settings', icon: <Settings className="w-5 h-5 shrink-0" />, permission: 'can_view_settings' },
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

  const roleLabelKey = user?.role === 'owner' ? 'roleOwner' : user?.role === 'admin' ? 'roleAdmin' : user?.role === 'assistant' ? 'roleAssistant' : user?.role === 'teacher' ? 'roleTeacher' : isSuperAdminOnly ? 'roleAdmin' : null;
  const roleBadgeClass = user?.role ? getRoleBadge(user.role) : 'bg-slate-500/15 text-slate-400';
  const isLimitedAccess = user?.role === 'assistant';
  const centerName = user?.center?.name || user?.name || user?.phone || 'User';

  const sidebarContent = (
    <div
      className="flex flex-col h-full w-[280px]"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderInlineEnd: '1px solid var(--glass-border)',
      }}
    >
      {/* Logo + Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
        {user?.center?.logo_url ? (
          <img src={user.center.logo_url} alt={centerName} className="h-10 w-10 rounded-lg object-contain" />
        ) : (
          <Image src="/logo-icon.png" alt="CenterHQ" width={40} height={40} className="w-10 h-10 rounded-xl shrink-0 object-contain" />
        )}
        <Link href={isSuperAdminOnly ? '/admin' : '/dashboard'} className="text-lg font-bold text-[var(--text-primary)] truncate" onClick={onClose}>
          CenterHQ
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {isSuperAdminOnly && (
          <Link
            href="/admin"
            onClick={onClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              pathname?.startsWith('/admin')
                ? 'bg-red-500/20 text-red-400 border-s border-red-500'
                : 'text-red-400 hover:bg-red-500/10'
            }`}
            style={pathname?.startsWith('/admin') ? { borderInlineStartWidth: 3 } : {}}
          >
            <Shield className="w-5 h-5 shrink-0" />
            {t('admin')}
          </Link>
        )}
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-indigo-500/20 text-indigo-300 border-s border-indigo-500'
                  : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
              }`}
              style={isActive ? { borderInlineStartWidth: 3 } : {}}
            >
              {item.icon}
              {t(item.key)}
            </Link>
          );
        })}
        {isAdmin && !isSuperAdminOnly && (
          <Link
            href="/admin"
            onClick={onClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 mt-2 ${
              pathname?.startsWith('/admin')
                ? 'bg-red-500/20 text-red-400 border-s border-red-500'
                : 'text-red-400 hover:bg-red-500/10'
            }`}
            style={pathname?.startsWith('/admin') ? { borderInlineStartWidth: 3 } : {}}
          >
            <Shield className="w-5 h-5 shrink-0" />
            {t('admin')}
          </Link>
        )}
      </nav>

      {/* Bottom: center name, role, theme, language, logout */}
      <div className="p-4 border-t border-white/10 space-y-3">
        {user && (
          <div>
            <p className="text-xs text-[var(--text-secondary)] truncate">{centerName}</p>
            {roleLabelKey && (
              <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${roleBadgeClass}`}>
                {t(roleLabelKey)}
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
        </div>
        <button
          onClick={() => { onClose?.(); toggleMode(); }}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)] rounded-lg transition-colors"
          title={t('switchToWebMode')}
        >
          <Monitor className="w-5 h-5 shrink-0" />
          {t('switchToWebMode')}
        </button>
        {user && (
          <button
            onClick={handleLogout}
            className="w-full text-start px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            {t('logout')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 print:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 start-0 z-50 h-full transition-transform duration-300 ease-in-out print:hidden ${
          open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        }`}
        style={{ width: 280 }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

export function SidebarHamburger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="fixed top-4 start-4 z-50 p-2 rounded-lg glass text-[var(--text-primary)] hover:opacity-90 transition-colors print:hidden"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
    >
      {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
    </button>
  );
}
