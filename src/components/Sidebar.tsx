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
  X,
} from 'lucide-react';

const SIDEBAR_EXPANDED = 256;
const SIDEBAR_COLLAPSED = 64;

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations('nav');
  const tSettings = useTranslations('settings');
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);

  const isRTL = locale === 'ar';

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

  if (!open) return null;

  return (
    <>
      {/* Backdrop - mobile and desktop when overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 md:z-40 print:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`flex flex-col fixed top-0 bottom-0 h-screen transition-transform duration-300 z-50 print:hidden w-64 md:w-56 ${
          isRTL ? 'right-0' : 'left-0'
        } ${open ? 'translate-x-0' : isRTL ? 'translate-x-full' : '-translate-x-full'}`}
        style={{ background: 'var(--gradient-navy)' }}
      >
      {/* Logo + Close */}
      <div className="flex items-center justify-between gap-3 px-4 h-16 border-b border-white/10">
        <Link
          href={isSuperAdminOnly ? '/admin' : '/dashboard'}
          className="flex items-center gap-3 shrink-0"
        >
          {user?.center?.logo_url ? (
            <img src={user.center.logo_url} alt={centerName} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
          ) : (
            <Image src="/logo-icon.png" alt="CenterHQ" width={36} height={36} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
          )}
          <span className="font-bold text-white text-lg tracking-tight">CenterHQ</span>
        </Link>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors" aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      {/* Center name */}
      {user && (
        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-xs text-white/40 mb-0.5">{tSettings('centerName')}</p>
          <p className="text-sm font-semibold text-white truncate">{centerName}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {isSuperAdminOnly && (
          <Link href="/admin" className={`nav-item ${pathname?.startsWith('/admin') ? 'active' : ''}`} onClick={onClose}>
            <Shield size={18} className="shrink-0" />
            <span>{t('admin')}</span>
          </Link>
        )}
        {navItems.map(({ key, href, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href} className={`nav-item ${isActive ? 'active' : ''}`} onClick={onClose}>
              <Icon size={18} className="shrink-0" />
              <span>{t(key)}</span>
            </Link>
          );
        })}
        {isAdmin && !isSuperAdminOnly && (
          <Link href="/admin" className={`nav-item ${pathname?.startsWith('/admin') ? 'active' : ''}`} onClick={onClose}>
            <Shield size={18} className="shrink-0" />
            <span>{t('admin')}</span>
          </Link>
        )}
      </nav>

      {/* Bottom */}
      <div className="p-2 border-t border-white/10 space-y-1">
        {user && (
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
          <button onClick={handleLogout} className="nav-item w-full">
            <LogOut size={16} />
            <span className="text-sm">{t('logout')}</span>
          </button>
        )}
      </div>
    </aside>
    </>
  );
}

export { SIDEBAR_EXPANDED, SIDEBAR_COLLAPSED };
