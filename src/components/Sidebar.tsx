'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey, UserRole } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  Users,
  QrCode,
  CreditCard,
  BookOpen,
  DoorOpen,
  Calendar,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const SIDEBAR_EXPANDED = 256;
const SIDEBAR_COLLAPSED = 64;
const STORAGE_KEY = 'centerhq-sidebar-collapsed';

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export default function Sidebar({ collapsed: controlledCollapsed, onCollapsedChange }: SidebarProps) {
  const t = useTranslations('nav');
  const tSettings = useTranslations('settings');
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);

  const isRTL = locale === 'ar';

  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = (value: boolean) => {
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, String(value));
    if (onCollapsedChange) onCollapsedChange(value);
    else setInternalCollapsed(value);
  };

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

  const allNavItems: { key: string; href: string; icon: React.ElementType; permission?: PermissionKey; ownerAdminOnly?: boolean }[] = [
    { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'can_view_dashboard' },
    { key: 'scanner', href: '/scan', icon: QrCode, permission: 'can_scan' },
    { key: 'students', href: '/students', icon: Users, permission: 'can_manage_students' },
    { key: 'payments', href: '/payments', icon: CreditCard, permission: 'can_view_payments' },
    { key: 'groups', href: '/groups', icon: BookOpen, permission: 'can_manage_groups' },
    { key: 'rooms', href: '/rooms', icon: DoorOpen, ownerAdminOnly: true },
    { key: 'schedule', href: '/schedule', icon: Calendar, permission: 'can_view_schedule' },
    { key: 'settings', href: '/settings', icon: Settings, permission: 'can_view_settings' },
  ];

  const isSuperAdminOnly = isAdmin && !user?.center_id;
  const navItems = isSuperAdminOnly
    ? []
    : user
      ? allNavItems.filter((item) => {
          if (item.ownerAdminOnly) return user.role === 'owner' || user.role === 'admin';
          if (user.role === 'owner' || user.role === 'admin') return true;
          if (!item.permission) return true;
          return hasPermission(item.permission);
        })
      : [];

  const roleLabelKey = user?.role === 'owner' ? 'roleOwner' : user?.role === 'admin' ? 'roleAdmin' : user?.role === 'assistant' ? 'roleAssistant' : user?.role === 'teacher' ? 'roleTeacher' : isSuperAdminOnly ? 'roleAdmin' : null;
  const centerName = user?.center?.name || user?.name || user?.phone || 'User';

  const CollapseIcon = isRTL
    ? (collapsed ? ChevronLeft : ChevronRight)
    : (collapsed ? ChevronRight : ChevronLeft);

  return (
    <aside
      className={`hidden md:flex flex-col fixed left-0 top-0 bottom-0 h-screen transition-all duration-300 z-40 print:hidden ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      style={{ background: 'var(--gradient-navy)' }}
    >
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-white/10 ${collapsed ? 'justify-center px-0' : ''}`}>
        <Link
          href={isSuperAdminOnly ? '/admin' : '/dashboard'}
          className="flex items-center gap-3 shrink-0"
        >
          {user?.center?.logo_url ? (
            <img src={user.center.logo_url} alt={centerName} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
          ) : (
            <Image src="/logo-icon.png" alt="CenterHQ" width={36} height={36} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
          )}
        </Link>
        {!collapsed && (
          <span className="font-bold text-white text-lg tracking-tight">CenterHQ</span>
        )}
      </div>

      {/* Center name */}
      {!collapsed && user && (
        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-xs text-white/40 mb-0.5">{tSettings('centerName')}</p>
          <p className="text-sm font-semibold text-white truncate">{centerName}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`nav-item ${pathname?.startsWith('/admin') ? 'active' : ''} ${collapsed ? 'justify-center px-0 py-2.5' : ''}`}
            title={collapsed ? t('admin') : undefined}
          >
            <Shield size={18} className="shrink-0" />
            {!collapsed && <span>{t('admin')}</span>}
          </Link>
        )}
        {navItems.map(({ key, href, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-0 py-2.5' : ''}`}
              title={collapsed ? t(key) : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{t(key)}</span>}
            </Link>
          );
        })}
        {isAdmin && !isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`nav-item ${pathname?.startsWith('/admin') ? 'active' : ''} ${collapsed ? 'justify-center px-0 py-2.5' : ''}`}
            title={collapsed ? t('admin') : undefined}
          >
            <Shield size={18} className="shrink-0" />
            {!collapsed && <span>{t('admin')}</span>}
          </Link>
        )}
      </nav>

      {/* Bottom */}
      <div className="p-2 border-t border-white/10 space-y-1">
        {!collapsed && user && (
          <div className="px-3 py-2 rounded-lg" style={{ background: 'hsl(var(--sidebar-accent))' }}>
            <p className="text-xs text-white/50">{t('logout')}</p>
            <p className="text-sm font-medium text-white">{centerName}</p>
            {roleLabelKey && (
              <span className="text-xs px-1.5 py-0.5 rounded-full text-white/70" style={{ background: 'hsl(var(--primary) / 0.3)' }}>
                {t(roleLabelKey)}
              </span>
            )}
          </div>
        )}
        {user && (
          <button
            onClick={handleLogout}
            className={`nav-item w-full ${collapsed ? 'justify-center px-0' : ''}`}
            title={collapsed ? t('logout') : undefined}
          >
            <LogOut size={16} />
            {!collapsed && <span className="text-sm">{t('logout')}</span>}
          </button>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute top-1/2 -translate-y-1/2 w-5 h-10 rounded-e-lg flex items-center justify-center transition-colors z-50 bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
        style={{ [isRTL ? 'right' : 'left']: '100%' }}
        aria-label="Toggle sidebar"
      >
        <CollapseIcon size={12} />
      </button>
    </aside>
  );
}

export { SIDEBAR_EXPANDED, SIDEBAR_COLLAPSED };
