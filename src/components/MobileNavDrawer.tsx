'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore } from '@/stores/branchStore';
import type { PermissionKey } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
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
  Gift,
  KeyRound,
  BarChart3,
  GraduationCap,
  Building2,
  Gauge,
  MessageCircle,
} from 'lucide-react';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { BranchSwitcher } from '@/components/layout/BranchSwitcher';

type NavItem = {
  key: string;
  href: string;
  icon: React.ElementType;
  permission?: PermissionKey;
  ownerAdminOnly?: boolean;
  ownerOnly?: boolean;
  showNewBadge?: boolean;
};

const ALL_NAV: NavItem[] = [
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

const BENCHMARKS_LAUNCH = new Date('2025-03-15');

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  const isSuperAdminOnly = isAdmin && !user?.center_id;

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
    void checkAdmin();
  }, []);

  const navItems = isSuperAdminOnly
    ? []
    : user
      ? ALL_NAV.filter((item) => {
          if (item.ownerOnly) return user.role === 'owner';
          if (item.ownerAdminOnly) return user.role === 'owner' || user.role === 'admin';
          if (user.role === 'owner' || user.role === 'admin') return true;
          if (!item.permission) return true;
          return hasPermission(item.permission);
        })
      : [];

  const roleNavKey: 'roleOwner' | 'roleAdmin' | 'roleAssistant' | 'roleTeacher' | null =
    user?.role === 'owner'
      ? 'roleOwner'
      : user?.role === 'admin'
        ? 'roleAdmin'
        : user?.role === 'assistant'
          ? 'roleAssistant'
          : user?.role === 'teacher'
            ? 'roleTeacher'
            : isSuperAdminOnly
              ? 'roleAdmin'
              : null;

  const { branches, activeCenterId } = useBranchStore();
  const activeBranch = branches.find((b) => b.id === activeCenterId);
  const centerName = activeBranch?.name || user?.center?.name || user?.name || user?.phone || 'User';

  const showBenchmarksNewBadge = (Date.now() - BENCHMARKS_LAUNCH.getTime()) / (24 * 60 * 60 * 1000) < 30;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
    onClose();
  };

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-sm font-medium transition-colors ${
      active ? 'bg-teal-600/10 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <>
      <aside
        className={`fixed top-0 start-0 h-full w-64 z-[60] lg:hidden flex flex-col bg-slate-900 border-e border-slate-800 transition-transform duration-[250ms] ease-in-out ${
          open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between gap-3 px-4 h-16 border-b border-slate-800 shrink-0">
          <Link
            href={isSuperAdminOnly ? '/admin' : '/dashboard'}
            className="flex items-center gap-3 shrink-0"
            onClick={onClose}
          >
            {user?.center?.logo_url ? (
              <img src={user.center.logo_url} alt={centerName} className="w-9 h-9 rounded-lg object-contain" />
            ) : (
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                CH
              </div>
            )}
            <span className="font-bold text-white text-lg tracking-tight">CenterHQ</span>
          </Link>
        </div>

        {user && !isSuperAdminOnly && (
          <div className="border-b border-slate-800">
            <BranchSwitcher />
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {isSuperAdminOnly && (
            <Link href="/admin" className={linkClass(!!pathname?.startsWith('/admin'))} onClick={onClose}>
              <Shield size={18} className="shrink-0" />
              <span>{tNav('admin')}</span>
            </Link>
          )}
          {navItems.map(({ key, href, icon: Icon, showNewBadge }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            const showBadge = showNewBadge && showBenchmarksNewBadge;
            return (
              <Link key={href} href={href} className={linkClass(isActive)} onClick={onClose}>
                <Icon size={18} className="shrink-0" />
                <span>{tNav(key as Parameters<typeof tNav>[0])}</span>
                {showBadge ? (
                  <span className="ms-auto px-1.5 py-0.5 text-[10px] font-semibold bg-teal-500/20 text-teal-400 rounded">
                    {tNav('newBadge')}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {isAdmin && !isSuperAdminOnly && user && (
            <Link
              href="/admin"
              className={linkClass(!!pathname?.startsWith('/admin'))}
              onClick={onClose}
            >
              <Shield size={18} className="shrink-0" />
              <span>{tNav('admin')}</span>
            </Link>
          )}
        </nav>

        <div className="border-t border-slate-800 p-4 bg-slate-800/50 shrink-0">
          {user && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                <span className="text-white text-sm font-bold">
                  {(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{centerName}</p>
                <p className="text-xs text-slate-400">{roleNavKey ? tNav(roleNavKey) : ''}</p>
              </div>
            </div>
          )}
          {user && (
            <>
              <button
                type="button"
                onClick={() => setIsPinModalOpen(true)}
                className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full mb-2"
              >
                <KeyRound size={16} className="shrink-0" />
                <span>تغيير الرمز السري</span>
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
              >
                <LogOut size={16} className="shrink-0" />
                <span>{tNav('logout')}</span>
              </button>
            </>
          )}
        </div>
        <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
      </aside>
    </>
  );
}
