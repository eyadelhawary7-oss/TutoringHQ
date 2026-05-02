'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  FileText,
  Clock,
  Users,
  Target,
  BarChart3,
  IdCard,
  Gift,
  Wallet,
  CalendarCheck,
  MessageCircle,
  Globe,
  Menu,
  X,
  Truck,
  Banknote,
  Settings,
  Activity,
  TrendingUp,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';
import { getAdminPermissions } from '@/lib/admin-roles';
import { supabase } from '@/lib/supabase';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export type AdminTab =
  | 'overview'
  | 'ceoDashboard'
  | 'centers'
  | 'billing'
  | 'cardOrders'
  | 'planRequests'
  | 'pendingSignups'
  | 'renewals'
  | 'referrals'
  | 'withdrawals'
  | 'internalTeam'
  | 'salesPipeline'
  | 'analytics';

/** Shown only when admin_users.role === 'super_admin' (see /api/admin/check). */
const SUPER_ONLY_PERMISSION_KEYS = new Set(['billing', 'withdrawals', 'internal_team']);

const ADMIN_NAV: { key: AdminTab; icon: React.ElementType; labelKey: string; permissionKey: string }[] = [
  { key: 'overview', icon: LayoutDashboard, labelKey: 'overview', permissionKey: 'overview' },
  { key: 'ceoDashboard', icon: BarChart3, labelKey: 'ceoDashboard', permissionKey: 'ceo_dashboard' },
  { key: 'centers', icon: Building2, labelKey: 'centers', permissionKey: 'centers' },
  { key: 'billing', icon: CreditCard, labelKey: 'billing', permissionKey: 'billing' },
  { key: 'pendingSignups', icon: Clock, labelKey: 'pendingSignups', permissionKey: 'pending_signups' },
  { key: 'cardOrders', icon: IdCard, labelKey: 'cardOrders', permissionKey: 'card_orders' },
  { key: 'planRequests', icon: FileText, labelKey: 'planRequests', permissionKey: 'plan_requests' },
  { key: 'renewals', icon: CalendarCheck, labelKey: 'renewals', permissionKey: 'renewals' },
  { key: 'referrals', icon: Gift, labelKey: 'referralsNav', permissionKey: 'referrals' },
  { key: 'withdrawals', icon: Wallet, labelKey: 'withdrawals', permissionKey: 'withdrawals' },
  { key: 'internalTeam', icon: Users, labelKey: 'internalTeam', permissionKey: 'internal_team' },
  { key: 'salesPipeline', icon: Target, labelKey: 'salesPipeline', permissionKey: 'sales_pipeline' },
  { key: 'analytics', icon: BarChart3, labelKey: 'analytics', permissionKey: 'analytics' },
];

interface AdminSidebarProps {
  activeTab?: AdminTab | null;
  onTabChange?: (tab: AdminTab) => void;
  activeRoute?: string;
  /** Desktop rail from top-0 when there is no fixed admin header (e.g. hideShell tools page) */
  desktopSidebarFullHeight?: boolean;
}

export function AdminSidebar({
  activeTab,
  onTabChange,
  activeRoute,
  desktopSidebarFullHeight = false,
}: AdminSidebarProps) {
  const t = useTranslations('admin');
  const tSettings = useTranslations('settings');
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const { closeMainSidebar } = useSidebar() ?? {};

  const [openMenu, setOpenMenu] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [customPermissions, setCustomPermissions] = useState<string[]>([]);
  const [pendingCentersCount, setPendingCentersCount] = useState(0);
  const isCeo =
    activeRoute === '/ceo' ||
    activeRoute === '/ceo-dashboard' ||
    activeRoute?.endsWith('/ceo') ||
    activeRoute?.endsWith('/ceo-dashboard');
  const isOrders = activeRoute?.includes('admin/orders');
  const isVendors = activeRoute?.includes('admin/vendors');
  const isRenewals = activeRoute?.includes('admin/renewals');
  const isPricing = activeRoute?.includes('admin/pricing');
  const isPlatformConfig = activeRoute?.includes('admin/platform-config');
  const isWaPack = activeRoute?.includes('admin/whatsapp-pack');
  const isWithdrawals = activeRoute?.includes('admin/withdrawals');
  const isReferrals = activeRoute?.includes('admin/referrals');
  const isReferralRewards = activeRoute?.includes('admin/referral-rewards');
  const isHealth = activeRoute?.includes('admin/health');
  const isStaff = activeRoute?.includes('admin/staff');
  const isCenterAssignments = activeRoute?.includes('admin/center-assignments');
  const isCommissions = activeRoute?.includes('admin/commissions');
  const isPayouts = activeRoute?.includes('admin/payouts');

  /** Sub-routes under admin - main `?tab=` items must not stay highlighted as Overview, etc. */
  const onDedicatedAdminSubpage =
    isWithdrawals ||
    isRenewals ||
    isPricing ||
    isPlatformConfig ||
    isVendors ||
    isWaPack ||
    isOrders ||
    isReferrals ||
    isReferralRewards ||
    isHealth ||
    isStaff ||
    isCenterAssignments ||
    isCommissions ||
    isPayouts ||
    isCeo;

  const allowedKeys =
    adminRole === 'super_admin' ? null : adminRole ? getAdminPermissions(adminRole, customPermissions) : null;

  const canSee = useCallback(
    (permissionKey: string) => allowedKeys === null || allowedKeys.includes(permissionKey),
    [allowedKeys],
  );

  const navItems = useMemo(
    () =>
      ADMIN_NAV.filter(({ permissionKey, key }) => {
        if (SUPER_ONLY_PERMISSION_KEYS.has(permissionKey)) {
          return adminRole === 'super_admin' && canSee(permissionKey);
        }
        if (key === 'renewals' && adminRole === 'super_admin') return false;
        return canSee(permissionKey);
      }),
    [adminRole, canSee],
  );

  useEffect(() => {
    let cancelled = false;
    const loadPendingCentersCount = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const { count, error } = await supabase
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (!cancelled) {
        setPendingCentersCount(error == null && count != null ? count : 0);
      }
    };
    void loadPendingCentersCount();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loadAdminRole = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data?.isAdmin) {
          setAdminRole(data.role ?? 'admin');
          setCustomPermissions(data.customPermissions ?? []);
        }
      } catch {
        setAdminRole('admin');
      }
    };
    void loadAdminRole();
  }, []);

  useEffect(() => {
    if (typeof closeMainSidebar === 'function') {
      closeMainSidebar();
    }
  }, [closeMainSidebar]);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const phone = user.email?.replace('@centerhq.local', '') ?? '';
      const displayPhone = phone ? `+${phone}` : 'Admin';
      setUserName(user.user_metadata?.name ?? displayPhone);
      setUserPhone(displayPhone);
    };
    void loadUser();
  }, []);

  useEffect(() => {
    document.body.style.overflow = openMenu ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMenu]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-admin-mobile-user-menu]')) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const afterNavigate = useCallback(() => {
    closeMainSidebar?.();
    setOpenMenu(false);
  }, [closeMainSidebar]);

  const handleLocaleToggle = useCallback(() => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
    });
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch('/api/user/locale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locale: newLocale }),
      }).catch(() => undefined);
    })();
  }, [locale, pathname, router, startTransition]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
    afterNavigate();
  };

  const runPrimaryNav = (key: AdminTab) => {
    afterNavigate();
    if (key === 'ceoDashboard') {
      onTabChange?.(key);
      return;
    }
    if (key === 'renewals') {
      router.push('/admin/renewals');
      return;
    }
    if (key === 'cardOrders') {
      router.push('/admin/orders');
      return;
    }
    if (key === 'withdrawals') {
      router.push('/admin/withdrawals');
      return;
    }
    if (isCeo || isOrders) router.push('/admin');
    onTabChange?.(key);
  };

  const drawerBtn = (active: boolean) =>
    cn(
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
      active
        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
    );

  const desktopAsideTop = desktopSidebarFullHeight ? 'top-0' : 'top-14';

  return (
    <>
      {/* Mobile top bar - matches center shell pattern */}
      <header className="lg:hidden fixed top-0 start-0 end-0 z-40 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] min-h-14 flex items-center justify-center print:hidden relative px-4">
        <div className="absolute start-4 top-1/2 -translate-y-1/2 z-10 lg:hidden">
          {openMenu ? (
            <X
              className="h-6 w-6 cursor-pointer text-[var(--color-text-primary)]"
              onClick={() => setOpenMenu(false)}
            />
          ) : (
            <Menu
              className="h-6 w-6 cursor-pointer text-[var(--color-text-primary)]"
              onClick={() => setOpenMenu(true)}
            />
          )}
        </div>

        <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo-icon.png"
            alt="CenterHQ"
            width={28}
            height={28}
            className="w-7 h-7 rounded-lg shrink-0 object-contain"
          />
          <span
            className="text-sm"
            style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
          >
            <span className="text-[var(--color-text-primary)]">CENTER</span>
            <span className="text-teal-600">HQ</span>
          </span>
        </Link>

        <div
          className="absolute end-4 top-1/2 -translate-y-1/2 flex items-center gap-2"
          data-admin-mobile-user-menu
        >
          <button
            type="button"
            onClick={handleLocaleToggle}
            disabled={isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors disabled:opacity-50"
          >
            <Globe size={13} />
            <span>{locale === 'ar' ? 'EN' : '\u0639'}</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((v) => !v)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground bg-teal-600 hover:bg-teal-700 transition-colors"
            >
              {(userName || userPhone || 'U').charAt(0).toUpperCase()}
            </button>
            {isUserMenuOpen ? (
              <div className="absolute top-12 start-0 bg-[var(--color-surface-1)] rounded-xl shadow-lg border border-[var(--color-border-subtle)] py-1 z-50 min-w-[200px]">
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{userName || '-'}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]" dir="ltr">
                    {userPhone || '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPinModalOpen(true);
                    setIsUserMenuOpen(false);
                  }}
                  className="w-full text-start px-4 py-2.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
                >
                  {tSettings('changePin')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="w-full text-start px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  تسجيل الخروج
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />

      {openMenu ? (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setOpenMenu(false)}
          aria-hidden
        />
      ) : null}

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 start-0 h-full w-64 z-[60] lg:hidden flex flex-col bg-[var(--color-surface-1)] border-e border-[var(--color-border)] transition-transform duration-[250ms] ease-in-out ${
          openMenu ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        }`}
        aria-hidden={!openMenu}
      >
        <div className="p-4 border-b border-[var(--color-border)] shrink-0">
          <Link
            href="/dashboard"
            onClick={afterNavigate}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] block mb-3"
          >
            {t('backToMyCenter')}
          </Link>
          <h2 className="font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ key, icon: Icon, labelKey }) => {
            const isActive =
              key === 'ceoDashboard'
                ? activeTab === 'ceoDashboard' || isCeo
                : key === 'withdrawals'
                  ? isWithdrawals
                  : key === 'referrals'
                    ? activeTab === 'referrals' || isReferrals || isReferralRewards
                    : key === 'renewals'
                      ? isRenewals
                      : key === 'cardOrders'
                        ? isOrders
                        : key === 'overview'
                          ? activeTab === 'overview' && !onDedicatedAdminSubpage
                          : activeTab === key && !onDedicatedAdminSubpage;
            const items: React.ReactNode[] = [
              <button
                key={key}
                type="button"
                onClick={() => runPrimaryNav(key)}
                className={drawerBtn(!!isActive)}
              >
                <Icon size={18} className="shrink-0" />
                <span>{t(labelKey as Parameters<typeof t>[0])}</span>
                {key === 'pendingSignups' && pendingCentersCount > 0 ? (
                  <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-600 text-primary-foreground text-[11px] font-bold px-1.5">
                    {pendingCentersCount}
                  </span>
                ) : null}
              </button>,
            ];
            if (key === 'centers' && adminRole === 'super_admin') {
              items.push(
                <Link
                  key="platform-health"
                  href="/admin/health"
                  onClick={afterNavigate}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                    isHealth
                      ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <Activity size={18} className="shrink-0" />
                  <span>{t('platformHealth')}</span>
                </Link>,
              );
            }
            if (key === 'referrals') {
              items.push(
                <Link
                  key="referral-rewards"
                  href="/admin/referral-rewards"
                  onClick={afterNavigate}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                    isReferralRewards
                      ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <Gift size={18} className="shrink-0" />
                  <span>{t('referralRewards.title')}</span>
                </Link>,
              );
            }
            if (key === 'billing') {
              if (adminRole === 'super_admin' && canSee('renewals')) {
                items.push(
                  <button
                    key="renewals"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/renewals');
                    }}
                    className={drawerBtn(!!isRenewals)}
                  >
                    <CalendarCheck size={18} className="shrink-0" />
                    <span>{t('renewals')}</span>
                  </button>,
                );
              }
              if (adminRole === 'super_admin') {
                items.push(
                  <button
                    key="pricing"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/pricing');
                    }}
                    className={drawerBtn(!!isPricing)}
                  >
                    <Banknote size={18} className="shrink-0" />
                    <span>{t('pricingPanel')}</span>
                  </button>,
                );
              }
              if (adminRole === 'super_admin') {
                items.push(
                  <button
                    key="platformConfig"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/platform-config');
                    }}
                    className={drawerBtn(!!isPlatformConfig)}
                  >
                    <Settings size={18} className="shrink-0" />
                    <span>{t('platformConfigNav')}</span>
                  </button>,
                );
              }
              if (canSee('card_orders') && adminRole === 'super_admin') {
                items.push(
                  <button
                    key="vendors"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/vendors');
                    }}
                    className={drawerBtn(!!isVendors)}
                  >
                    <Truck size={18} className="shrink-0" />
                    <span>{t('vendorsNav')}</span>
                  </button>,
                );
              }
              if (canSee('ceo_dashboard')) {
                items.push(
                  <button
                    key="whatsappPack"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/whatsapp-pack');
                    }}
                    className={drawerBtn(!!isWaPack)}
                  >
                    <MessageCircle size={18} className="shrink-0" />
                    <span>{t('whatsappPack')}</span>
                  </button>,
                );
              }
            }
            return items;
          })}
          {/* HR & Commissions group */}
          {adminRole === 'super_admin' ? (
            <>
              <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {t('sidebarHr')}
              </p>
              <Link
                href="/admin/staff"
                onClick={afterNavigate}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isStaff
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <Users size={18} className="shrink-0" />
                <span>{t('staff.title')}</span>
              </Link>
              <Link
                href="/admin/center-assignments"
                onClick={afterNavigate}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isCenterAssignments
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <MapPin size={18} className="shrink-0" />
                <span>{t('centerAssignments.title')}</span>
              </Link>
              <Link
                href="/admin/commissions"
                onClick={afterNavigate}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isCommissions
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <TrendingUp size={18} className="shrink-0" />
                <span>{t('commissions.title')}</span>
              </Link>
              <Link
                href="/admin/payouts"
                onClick={afterNavigate}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isPayouts
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <CreditCard size={18} className="shrink-0" />
                <span>{t('payouts.title')}</span>
              </Link>
            </>
          ) : null}
        </nav>
        <div className="shrink-0 p-2 border-t border-[var(--color-border)]">
          <div className="px-1">
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed start-0 w-56 z-20 bg-[var(--color-surface-1)] border-e border-[var(--color-border)] bottom-0',
          desktopAsideTop,
        )}
      >
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <h2 className="font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <Link
            href="/dashboard"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mt-1 block"
          >
            {t('backToMyCenter')}
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ key, icon: Icon, labelKey }) => {
            const isActive =
              key === 'ceoDashboard'
                ? activeTab === 'ceoDashboard' || isCeo
                : key === 'withdrawals'
                  ? isWithdrawals
                  : key === 'referrals'
                    ? activeTab === 'referrals' || isReferrals || isReferralRewards
                    : key === 'renewals'
                      ? isRenewals
                      : key === 'cardOrders'
                        ? isOrders
                        : key === 'overview'
                          ? activeTab === 'overview' && !onDedicatedAdminSubpage
                          : activeTab === key && !onDedicatedAdminSubpage;
            const items: React.ReactNode[] = [
              <button
                key={key}
                type="button"
                onClick={() => {
                  closeMainSidebar?.();
                  if (key === 'ceoDashboard') {
                    onTabChange?.(key);
                    return;
                  }
                  if (key === 'renewals') {
                    router.push('/admin/renewals');
                    return;
                  }
                  if (key === 'cardOrders') {
                    router.push('/admin/orders');
                    return;
                  }
                  if (key === 'withdrawals') {
                    router.push('/admin/withdrawals');
                    return;
                  }
                  if (key === 'referrals') {
                    onTabChange?.(key);
                    return;
                  }
                  if (isCeo || isOrders) router.push('/admin');
                  onTabChange?.(key);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                  isActive
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <Icon size={18} />
                <span>{t(labelKey as Parameters<typeof t>[0])}</span>
                {key === 'pendingSignups' && pendingCentersCount > 0 ? (
                  <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold px-1.5">
                    {pendingCentersCount}
                  </span>
                ) : null}
              </button>,
            ];
            if (key === 'centers' && adminRole === 'super_admin') {
              items.push(
                <Link
                  key="platform-health"
                  href="/admin/health"
                  onClick={() => closeMainSidebar?.()}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                    isHealth
                      ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                  )}
                >
                  <Activity size={18} className="shrink-0" />
                  <span>{t('platformHealth')}</span>
                </Link>,
              );
            }
            if (key === 'referrals') {
              items.push(
                <Link
                  key="referral-rewards"
                  href="/admin/referral-rewards"
                  onClick={() => closeMainSidebar?.()}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                    isReferralRewards
                      ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <Gift size={18} className="shrink-0" />
                  <span>{t('referralRewards.title')}</span>
                </Link>,
              );
            }
            if (key === 'billing') {
              if (adminRole === 'super_admin' && canSee('renewals')) {
                items.push(
                  <button
                    key="renewals"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/renewals');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                      isRenewals
                        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <CalendarCheck size={18} />
                    <span>{t('renewals')}</span>
                  </button>,
                );
              }
              if (adminRole === 'super_admin') {
                items.push(
                  <button
                    key="pricing"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/pricing');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                      isPricing
                        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <Banknote size={18} />
                    <span>{t('pricingPanel')}</span>
                  </button>,
                );
              }
              if (adminRole === 'super_admin') {
                items.push(
                  <button
                    key="platformConfig"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/platform-config');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                      isPlatformConfig
                        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <Settings size={18} />
                    <span>{t('platformConfigNav')}</span>
                  </button>,
                );
              }
              if (canSee('card_orders') && adminRole === 'super_admin') {
                items.push(
                  <button
                    key="vendors"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/vendors');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                      isVendors
                        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <Truck size={18} />
                    <span>{t('vendorsNav')}</span>
                  </button>,
                );
              }
              if (canSee('ceo_dashboard')) {
                items.push(
                  <button
                    key="whatsappPack"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/whatsapp-pack');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
                      isWaPack
                        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                    )}
                  >
                    <MessageCircle size={18} />
                    <span>{t('whatsappPack')}</span>
                  </button>,
                );
              }
            }
            return items;
          })}
          {/* HR & Commissions group */}
          {adminRole === 'super_admin' ? (
            <>
              <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {t('sidebarHr')}
              </p>
              <Link
                href="/admin/staff"
                onClick={() => closeMainSidebar?.()}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isStaff
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                )}
              >
                <Users size={18} />
                <span>{t('staff.title')}</span>
              </Link>
              <Link
                href="/admin/center-assignments"
                onClick={() => closeMainSidebar?.()}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isCenterAssignments
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                )}
              >
                <MapPin size={18} />
                <span>{t('centerAssignments.title')}</span>
              </Link>
              <Link
                href="/admin/commissions"
                onClick={() => closeMainSidebar?.()}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isCommissions
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                )}
              >
                <TrendingUp size={18} />
                <span>{t('commissions.title')}</span>
              </Link>
              <Link
                href="/admin/payouts"
                onClick={() => closeMainSidebar?.()}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start no-underline border-s-4 border-solid',
                  isPayouts
                    ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                )}
              >
                <CreditCard size={18} />
                <span>{t('payouts.title')}</span>
              </Link>
            </>
          ) : null}
        </nav>
        <div className="shrink-0 p-2 border-t border-[var(--color-border)]">
          <div className="px-1">
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
