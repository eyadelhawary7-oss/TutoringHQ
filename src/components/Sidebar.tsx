'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore } from '@/stores/branchStore';
import type { PermissionKey } from '@/contexts/UserContext';
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
  KeyRound,
  BarChart3,
  GraduationCap,
  Building2,
  Gauge,
  MessageCircle,
  Gift,
} from 'lucide-react';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { BranchSwitcher } from '@/components/layout/BranchSwitcher';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import { cn } from '@/lib/utils';

/** Desktop sidebar width in px (Tailwind w-60) */
const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 64;

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

function navLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm font-medium transition-colors duration-150 border-solid border-s-4',
    isActive
      ? 'border-[var(--color-teal)] bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-600/15 dark:text-[var(--color-text-primary)]'
      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
  );
}

export default function Sidebar({ onClose }: SidebarProps) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const tRoles = useTranslations('roles');
  const tSettings = useTranslations('settings');
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [showBenchmarksNewBadge, setShowBenchmarksNewBadge] = useState(false);

  useEffect(() => {
    const BENCHMARKS_LAUNCH = new Date('2025-03-15').getTime();
    setShowBenchmarksNewBadge((Date.now() - BENCHMARKS_LAUNCH) / (24 * 60 * 60 * 1000) < 30);
  }, []);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
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
    await signOutToLogin(locale);
  };

  const isArLocale = locale === 'ar' || locale.startsWith('ar-');
  const allNavItems: {
    key: string;
    href: string;
    icon: React.ElementType;
    permission?: PermissionKey;
    ownerAdminOnly?: boolean;
    ownerOnly?: boolean;
    showNewBadge?: boolean;
  }[] = [
    { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'can_view_dashboard' },
    { key: 'analytics', href: '/analytics', icon: BarChart3, permission: 'can_view_revenue' },
    { key: 'benchmarks', href: '/benchmarks', icon: Gauge, permission: 'can_view_dashboard', showNewBadge: true },
    { key: 'scanner', href: '/scan', icon: QrCode, permission: 'can_scan' },
    { key: 'students', href: '/students', icon: Users, permission: 'can_manage_students' },
    { key: 'whatsappPack', href: '/whatsapp-pack', icon: MessageCircle, ownerAdminOnly: true },
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
          if (item.ownerOnly) return user.role === 'owner' || user.role === 'super_admin';
          if (item.ownerAdminOnly) return user.role === 'owner' || user.role === 'admin' || user.role === 'super_admin';
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
  const { branches, activeCenterId } = useBranchStore();
  const activeBranch = branches.find((b) => b.id === activeCenterId);
  const centerName = activeBranch?.name || user?.center?.name || user?.name || user?.phone || 'User';

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col fixed top-0 bottom-0 start-0 h-screen ${isArLocale ? 'w-72' : 'w-60'} z-[100] print:hidden bg-[var(--color-surface-1)] border-e border-[var(--color-border)] isolate`}
      >
        <div className="relative z-10 flex items-center gap-3 px-4 h-16 border-b border-[var(--color-border)] pointer-events-auto justify-between">
          <Link
            href={isSuperAdminOnly ? '/admin' : '/dashboard'}
            className="flex items-center shrink-0 gap-3 min-w-0"
            onClick={() => onClose?.()}
          >
            {user?.center?.logo_url ? (
              <img src={user.center.logo_url} alt={centerName} className="w-9 h-9 rounded-lg shrink-0 object-contain" />
            ) : (
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center shrink-0">
                <span className="text-primary-foreground font-bold text-sm">CH</span>
              </div>
            )}
            <span
              className="text-lg tracking-tight truncate"
              style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
            >
              <span className="text-[var(--color-text-primary)]">CENTER</span>
              <span className="text-teal-600">HQ</span>
            </span>
          </Link>
        </div>

        {user ? (
          <div className="border-b border-[var(--color-border)]">
            <BranchSwitcher />
          </div>
        ) : null}

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {isSuperAdminOnly && (
            <Link
              href="/admin"
              className={navLinkClass(!!pathname?.startsWith('/admin'))}
              onClick={() => onClose?.()}
            >
              <Shield size={18} className="shrink-0" />
              <span>{t('admin')}</span>
            </Link>
          )}
          {navItems.map(({ key, href, icon: Icon, showNewBadge }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            const showBadge = showNewBadge && showBenchmarksNewBadge;
            return (
              <Link key={href} href={href} className={navLinkClass(isActive)} onClick={() => onClose?.()}>
                <Icon size={18} className="shrink-0" />
                <span className={`${isArLocale ? 'whitespace-normal break-words leading-snug' : 'truncate'}`}>{t(key)}</span>
                {showBadge ? (
                  <span className="ms-auto px-1.5 py-0.5 text-[10px] font-semibold bg-teal-500/20 text-teal-400 rounded shrink-0">
                    {t('newBadge')}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {isAdmin && !isSuperAdminOnly && (
            <Link
              href="/admin"
              className={navLinkClass(!!pathname?.startsWith('/admin'))}
              onClick={() => onClose?.()}
            >
              <Shield size={18} className="shrink-0" />
              <span>{t('admin')}</span>
            </Link>
          )}
        </nav>

        <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-surface-2)]">
          {user && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-[var(--color-surface-3)] rounded-full flex items-center justify-center shrink-0">
                <span className="text-[var(--color-text-primary)] text-sm font-bold">{(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-secondary)] truncate">{centerName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{roleLabelText ?? ''}</p>
              </div>
            </div>
          )}
          {user && (
            <>
              <button
                type="button"
                onClick={() => setIsPinModalOpen(true)}
                className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors duration-150 w-full"
              >
                <KeyRound size={16} className="shrink-0" />
                <span className="truncate">{tSettings('changePin')}</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors duration-150 w-full mt-2"
              >
                <LogOut size={16} className="shrink-0" />
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
