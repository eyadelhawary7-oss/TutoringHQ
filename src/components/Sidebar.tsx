'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore } from '@/stores/branchStore';
import type { PermissionKey, UserRole } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  Users,
  QrCode,
  CreditCard,
  ClipboardList,
  BookOpen,
  DoorOpen,
  Calendar,
  Settings,
  Shield,
  LogOut,
  X,
  Gift,
  KeyRound,
  BarChart3,
  GraduationCap,
  Building2,
  Gauge,
} from 'lucide-react';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { BranchSwitcher } from '@/components/layout/BranchSwitcher';

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
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

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

  const BENCHMARKS_LAUNCH = new Date('2025-03-15');
  const showBenchmarksNewBadge = (Date.now() - BENCHMARKS_LAUNCH.getTime()) / (24 * 60 * 60 * 1000) < 30;

  const allNavItems: { key: string; href: string; icon: React.ElementType; permission?: PermissionKey; ownerAdminOnly?: boolean; ownerOnly?: boolean; showNewBadge?: boolean }[] = [
    { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'can_view_dashboard' },
    { key: 'analytics', href: '/analytics', icon: BarChart3, permission: 'can_view_revenue' },
    { key: 'benchmarks', href: '/benchmarks', icon: Gauge, permission: 'can_view_dashboard', showNewBadge: true },
    { key: 'scanner', href: '/scan', icon: QrCode, permission: 'can_scan' },
    { key: 'students', href: '/students', icon: Users, permission: 'can_manage_students' },
    { key: 'payments', href: '/payments', icon: CreditCard, permission: 'can_view_payments' },
    { key: 'attendance', href: '/attendance', icon: ClipboardList, permission: 'can_scan' },
    { key: 'groups', href: '/groups', icon: BookOpen, permission: 'can_manage_groups' },
    { key: 'rooms', href: '/rooms', icon: DoorOpen, ownerAdminOnly: true },
    { key: 'schedule', href: '/schedule', icon: Calendar, permission: 'can_view_schedule' },
    { key: 'academic', href: '/academic', icon: GraduationCap, ownerAdminOnly: true },
    { key: 'referrals', href: '/referrals', icon: Gift, ownerOnly: true },
    { key: 'branches', href: '/branches', icon: Building2, ownerAdminOnly: true },
    { key: 'settings', href: '/settings', icon: Settings, permission: 'can_view_settings' },
  ];

  const isSuperAdminOnly = isAdmin && !user?.center_id;
  const navItems = isSuperAdminOnly
    ? []
    : user
      ? allNavItems.filter((item) => {
          if (item.ownerOnly) return user.role === 'owner';
          if (item.ownerAdminOnly) return user.role === 'owner' || user.role === 'admin';
          if (user.role === 'owner' || user.role === 'admin') return true;
          if (!item.permission) return true;
          return hasPermission(item.permission);
        })
      : [];

  const roleLabelKey = user?.role === 'owner' ? 'roleOwner' : user?.role === 'admin' ? 'roleAdmin' : user?.role === 'assistant' ? 'roleAssistant' : user?.role === 'teacher' ? 'roleTeacher' : isSuperAdminOnly ? 'roleAdmin' : null;
  const { branches, activeCenterId } = useBranchStore();
  const activeBranch = branches.find((b) => b.id === activeCenterId);
  const centerName = activeBranch?.name || user?.center?.name || user?.name || user?.phone || 'User';

  return (
    <>
      {/* Backdrop - mobile only when overlay (desktop: sidebar is persistent, no backdrop) */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden print:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Desktop: persistent 256px sidebar (always visible). Mobile: drawer overlay when open */}
      <aside
        className={`flex flex-col fixed top-0 bottom-0 h-screen z-50 print:hidden w-64 bg-slate-900
          transition-transform duration-300
          ${isRTL ? 'right-0 md:left-auto md:right-0' : 'left-0 md:left-0'}
          ${open ? 'translate-x-0' : isRTL ? 'translate-x-full md:translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
      {/* Logo + Close */}
      <div className="flex items-center justify-between gap-3 px-4 h-16 border-b border-slate-800">
        <Link
          href={isSuperAdminOnly ? '/admin' : '/dashboard'}
          className="flex items-center gap-3 shrink-0"
        >
          {user?.center?.logo_url ? (
            <img src={user.center.logo_url} alt={centerName} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
          ) : (
            <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">CH</span>
            </div>
          )}
          <span className="font-bold text-white text-lg tracking-tight">CenterHQ</span>
        </Link>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      {/* Center name / Branch switcher */}
      {user && <BranchSwitcher />}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm font-medium transition-colors ${pathname?.startsWith('/admin') ? 'bg-teal-600/10 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            onClick={onClose}
          >
            <Shield size={18} className="shrink-0" />
            <span>{t('admin')}</span>
          </Link>
        )}
        {navItems.map(({ key, href, icon: Icon, showNewBadge }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          const showBadge = showNewBadge && showBenchmarksNewBadge;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm font-medium transition-colors ${isActive ? 'bg-teal-600/10 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              onClick={onClose}
            >
              <Icon size={18} className="shrink-0" />
              <span>{t(key)}</span>
              {showBadge && (
                <span className="ms-auto px-1.5 py-0.5 text-[10px] font-semibold bg-teal-500/20 text-teal-400 rounded">
                  {t('newBadge')}
                </span>
              )}
            </Link>
          );
        })}
        {isAdmin && !isSuperAdminOnly && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm font-medium transition-colors ${pathname?.startsWith('/admin') ? 'bg-teal-600/10 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            onClick={onClose}
          >
            <Shield size={18} className="shrink-0" />
            <span>{t('admin')}</span>
          </Link>
        )}
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-800 p-4 bg-slate-800/50">
        {user && (
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">{(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{centerName}</p>
              <p className="text-xs text-slate-400">{roleLabelKey ? t(roleLabelKey) : ''}</p>
            </div>
          </div>
        )}
        {user && (
          <>
            <button
              onClick={() => setIsPinModalOpen(true)}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
            >
              <KeyRound size={16} />
              <span>تغيير الرمز السري</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
            >
              <LogOut size={16} />
              <span>{t('logout')}</span>
            </button>
          </>
        )}
      </div>
      <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
    </aside>
    </>
  );
}

export { SIDEBAR_EXPANDED, SIDEBAR_COLLAPSED };
