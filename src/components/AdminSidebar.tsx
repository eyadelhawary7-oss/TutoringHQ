'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ChevronRight,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import { useSidebar } from '@/contexts/SidebarContext';
import { getAdminPermissions } from '@/lib/admin-roles';
import { supabase } from '@/lib/supabase';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Suspense } from 'react';
import { TestLiveToggle } from '@/components/admin/TestLiveToggle';

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
  | 'analytics'
  | 'platformHealth';

/** Shown only when admin_users.role === 'super_admin' (see /api/admin/check). */
const SUPER_ONLY_PERMISSION_KEYS = new Set(['billing', 'withdrawals', 'internal_team']);

const SIDEBAR_SECTIONS_KEY = 'chq-admin-sidebar-sections';

interface NavItemConfig {
  key: string;
  icon: React.ElementType;
  label: React.ReactNode;
  isActive: boolean;
  canShow: boolean;
  badge?: React.ReactNode;
  /** When set the item renders as a <Link>; when absent it renders as a <button>. */
  href?: string;
  action?: () => void;
}

interface SectionDef {
  key: string;
  labelKey: string;
  items: NavItemConfig[];
}

interface AdminSidebarProps {
  /**
   * Set to "overview" when rendering on `/admin` to highlight the Overview entry.
   * Dedicated admin sub-pages omit this prop and rely on `activeRoute`.
   */
  activeTab?: AdminTab | null;
  activeRoute?: string;
  /** Desktop rail from top-0 when there is no fixed admin header (e.g. hideShell tools page) */
  desktopSidebarFullHeight?: boolean;
}

export function AdminSidebar({
  activeTab,
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
  /** Which accordion sections are currently expanded. Empty set = all collapsed (default). */
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sectionsInitialized = useRef(false);

  const isCeo =
    activeRoute === '/ceo' ||
    activeRoute === '/ceo-dashboard' ||
    activeRoute?.endsWith('/ceo') ||
    activeRoute?.endsWith('/ceo-dashboard');
  const isOrders = activeRoute?.includes('admin/orders');
  const isVendors = activeRoute?.includes('admin/vendors');
  const isRenewals = activeRoute?.includes('admin/renewals');
  const isFinance = activeRoute?.includes('admin/finance');
  const isPricing = activeRoute?.includes('admin/pricing');
  const isPromoCodes = activeRoute?.includes('admin/promo-codes');
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
  const isCenters = activeRoute?.includes('admin/centers');
  const isBilling = activeRoute === '/admin/billing' || activeRoute?.endsWith('/admin/billing') || false;
  const isPlanRequests = activeRoute?.includes('admin/plan-requests');
  const isPendingSignups = activeRoute?.includes('admin/pending-signups');
  const isInternalTeam = activeRoute?.includes('admin/internal-team');
  const isSalesPipeline = activeRoute?.includes('admin/sales-pipeline');
  const isAnalytics = activeRoute?.includes('admin/analytics');

  /** Sub-routes under admin — main Overview entry must not stay highlighted on these. */
  const onDedicatedAdminSubpage =
    isWithdrawals ||
    isRenewals ||
    isFinance ||
    isPricing ||
    isPromoCodes ||
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
    isCenters ||
    isBilling ||
    isPlanRequests ||
    isPendingSignups ||
    isInternalTeam ||
    isSalesPipeline ||
    isAnalytics ||
    isCeo;

  const allowedKeys =
    adminRole === 'super_admin' ? null : adminRole ? getAdminPermissions(adminRole, customPermissions) : null;

  const canSee = useCallback(
    (permissionKey: string) => allowedKeys === null || allowedKeys.includes(permissionKey),
    [allowedKeys],
  );

  /**
   * Permission check respecting SUPER_ONLY_PERMISSION_KEYS: keys in that set require
   * super_admin role *and* the permission grant (mirrors the original ADMIN_NAV filter).
   */
  const canShowPermKey = useCallback(
    (permKey: string) => {
      if (SUPER_ONLY_PERMISSION_KEYS.has(permKey)) return adminRole === 'super_admin' && canSee(permKey);
      return canSee(permKey);
    },
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

  /**
   * Initialise accordion open-state.
   * Default: all sections open so every permitted item is visible regardless of route.
   * If the user has explicitly collapsed a section we still honour their localStorage
   * preference, but a missing entry means "open" (open-by-default).
   */
  useEffect(() => {
    if (sectionsInitialized.current) return;
    sectionsInitialized.current = true;

    const ALL_SECTION_KEYS = ['operational', 'growth', 'reporting', 'hrCommissions'];
    let stored: string[] | null = null;
    try {
      const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
      if (raw) stored = JSON.parse(raw) as string[];
    } catch {
      /* ignore parse errors */
    }

    // hrCommissions was added after the others; existing localStorage entries
    // don't list it, so it would ship collapsed. Force-include it unless the
    // user has explicitly toggled it (which can't have happened on first load).
    const initial = new Set(stored ?? ALL_SECTION_KEYS);
    if (stored && !initial.has('hrCommissions')) {
      initial.add('hrCommissions');
    }
    setOpenSections(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
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
    afterNavigate();
    await signOutToLogin(locale);
  };

  const navBtnClass = (active: boolean) =>
    cn(
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start border-s-4 border-solid',
      active
        ? 'border-[var(--color-teal)] bg-teal-50 text-teal-700 dark:border-teal-400 dark:bg-teal-600/15 dark:text-teal-200'
        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
    );

  const renderNavItem = (item: NavItemConfig) => {
    if (!item.canShow) return null;
    const cls = navBtnClass(item.isActive);
    const content = (
      <>
        <item.icon size={18} className="shrink-0" />
        <span>{item.label}</span>
        {item.badge ?? null}
      </>
    );
    if (item.href) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Link key={item.key} href={item.href as any} onClick={afterNavigate} className={cn(cls, 'no-underline')}>
          {content}
        </Link>
      );
    }
    return (
      <button key={item.key} type="button" onClick={item.action} className={cls}>
        {content}
      </button>
    );
  };

  // ── Section definitions ──────────────────────────────────────────────────────
  // Items are ordered as specified. canShow encodes the same permission rules as
  // the previous ADMIN_NAV filter + inline super_admin guards — including the
  // SUPER_ONLY_PERMISSION_KEYS set (billing, withdrawals, internal_team).
  const sections: SectionDef[] = [
    {
      key: 'operational',
      labelKey: 'sidebarSectionOperational',
      items: [
        {
          key: 'centers',
          icon: Building2,
          label: t('centers'),
          isActive: activeRoute?.startsWith('/admin/centers') || activeRoute?.includes('/admin/centers') || false,
          canShow: canSee('centers'),
          href: '/admin/centers',
        },
        {
          key: 'platformHealth',
          icon: Activity,
          label: t('platformHealth'),
          isActive: !!isHealth,
          canShow: adminRole === 'super_admin',
          href: '/admin/health',
        },
        {
          key: 'billing',
          icon: CreditCard,
          label: t('billing'),
          isActive: (activeRoute?.includes('admin/billing') ?? false) && !activeRoute?.includes('admin/billing-'),
          canShow: canShowPermKey('billing'),
          href: '/admin/billing',
        },
        {
          key: 'renewals',
          icon: CalendarCheck,
          label: t('renewals'),
          isActive: !!isRenewals,
          canShow: adminRole === 'super_admin' && canSee('renewals'),
          href: '/admin/renewals',
        },
        {
          key: 'finance',
          icon: TrendingUp,
          label: t('finance'),
          isActive: !!isFinance,
          canShow: adminRole === 'super_admin' && canSee('renewals'),
          action: () => {
            afterNavigate();
            router.push('/admin/finance');
          },
        },
        {
          key: 'pricing',
          icon: Banknote,
          label: t('pricingPanel'),
          isActive: !!isPricing,
          canShow: adminRole === 'super_admin',
          action: () => {
            afterNavigate();
            router.push('/admin/pricing');
          },
        },
        {
          key: 'platformConfig',
          icon: Settings,
          label: t('platformConfigNav'),
          isActive: !!isPlatformConfig,
          canShow: adminRole === 'super_admin',
          action: () => {
            afterNavigate();
            router.push('/admin/platform-config');
          },
        },
        {
          key: 'vendors',
          icon: Truck,
          label: t('vendorsNav'),
          isActive: !!isVendors,
          canShow: adminRole === 'super_admin' && canSee('card_orders'),
          action: () => {
            afterNavigate();
            router.push('/admin/vendors');
          },
        },
        {
          key: 'whatsappPack',
          icon: MessageCircle,
          label: t('whatsappPack'),
          isActive: !!isWaPack,
          canShow: canSee('ceo_dashboard'),
          action: () => {
            afterNavigate();
            router.push('/admin/whatsapp-pack');
          },
        },
      ],
    },
    {
      key: 'growth',
      labelKey: 'sidebarSectionGrowth',
      items: [
        {
          key: 'pendingSignups',
          icon: Clock,
          label: t('pendingSignups'),
          isActive: activeRoute?.includes('admin/pending-signups') ?? false,
          canShow: canSee('pending_signups'),
          badge:
            pendingCentersCount > 0 ? (
              <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-600 text-primary-foreground text-[11px] font-bold px-1.5">
                {pendingCentersCount}
              </span>
            ) : undefined,
          href: '/admin/pending-signups',
        },
        {
          key: 'planRequests',
          icon: FileText,
          label: t('planRequests'),
          isActive: activeRoute?.includes('admin/plan-requests') ?? false,
          canShow: canSee('plan_requests'),
          href: '/admin/plan-requests',
        },
        {
          key: 'promoCodes',
          icon: Tag,
          label: t('promoCodesNavLabel'),
          isActive: !!isPromoCodes,
          canShow: adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'internal_admin',
          href: '/admin/promo-codes',
        },
      ],
    },
    {
      key: 'reporting',
      labelKey: 'sidebarSectionReporting',
      items: [
        {
          key: 'analytics',
          icon: BarChart3,
          label: t('analytics'),
          isActive: activeRoute?.includes('admin/analytics') ?? false,
          canShow: canSee('analytics'),
          href: '/admin/analytics',
        },
        {
          key: 'salesPipeline',
          icon: Target,
          label: t('salesPipeline'),
          isActive: activeRoute?.includes('admin/sales-pipeline') ?? false,
          canShow: canSee('sales_pipeline'),
          href: '/admin/sales-pipeline',
        },
        {
          key: 'referrals',
          icon: Gift,
          label: t('referralsNav'),
          isActive: !!isReferrals,
          canShow: canSee('referrals'),
          href: '/admin/referrals',
        },
        {
          key: 'referralRewards',
          icon: Gift,
          label: t('referralRewards.title'),
          isActive: !!isReferralRewards,
          canShow: canSee('referrals'),
          href: '/admin/referral-rewards',
        },
        {
          key: 'cardOrders',
          icon: IdCard,
          label: t('cardOrders'),
          isActive: !!isOrders,
          canShow: canSee('card_orders'),
          href: '/admin/orders',
        },
        {
          key: 'withdrawals',
          icon: Wallet,
          label: t('withdrawals'),
          isActive: !!isWithdrawals,
          canShow: canShowPermKey('withdrawals'),
          href: '/admin/withdrawals',
        },
        {
          key: 'internalTeam',
          icon: Users,
          label: t('internalTeam'),
          isActive: activeRoute?.includes('admin/internal-team') ?? false,
          canShow: canShowPermKey('internal_team'),
          href: '/admin/internal-team',
        },
      ],
    },
    {
      key: 'hrCommissions',
      labelKey: 'sidebarSectionHrCommissions',
      items: [
        {
          key: 'staff',
          icon: Users,
          label: t('staff.title'),
          isActive: !!isStaff,
          canShow: adminRole === 'super_admin',
          href: '/admin/staff',
        },
        {
          key: 'centerAssignments',
          icon: MapPin,
          label: t('centerAssignments.title'),
          isActive: !!isCenterAssignments,
          canShow: adminRole === 'super_admin',
          href: '/admin/center-assignments',
        },
        {
          key: 'commissions',
          icon: TrendingUp,
          label: t('commissions.title'),
          isActive: !!isCommissions,
          canShow: adminRole === 'super_admin',
          href: '/admin/commissions',
        },
        {
          key: 'payouts',
          icon: CreditCard,
          label: t('payouts.title'),
          isActive: !!isPayouts,
          canShow: adminRole === 'super_admin',
          href: '/admin/payouts',
        },
      ],
    },
  ];

  const isLg = useMediaQuery('(min-width: 1024px)');
  /**
   * SSR-safe gate for the `inert` attribute. `useMediaQuery` returns `false`
   * until its post-mount effect runs, so naively applying `inert` when
   * `!isLg && !openMenu` would block all clicks on the desktop rail during
   * SSR + the first client paint (race observed in 190a850). We only ever
   * apply inert after the component is mounted AND we've confirmed we're
   * below the `lg` breakpoint — never on desktop.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const shouldInertSidebar = mounted && !isLg && !openMenu;
  const desktopTop = desktopSidebarFullHeight ? 'lg:top-0' : 'lg:top-14';

  const isOverviewActive = activeTab === 'overview' && !onDedicatedAdminSubpage;
  const isCeoDashActive = activeTab === 'ceoDashboard' || !!isCeo;

  return (
    <>
      {/* Mobile top bar - matches center shell pattern. */}
      {/* Must be position:fixed; pages render AdminSidebar inside a flex-row, */}
      {/* and any in-flow header here would steal ~240px of horizontal space. */}
      <header className="lg:hidden fixed top-0 start-0 end-0 z-40 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] min-h-14 flex items-center justify-center print:hidden px-4">
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={() => setOpenMenu(true)}
          className="absolute start-2 top-1/2 -translate-y-1/2 z-10 lg:hidden min-h-11 min-w-11 flex items-center justify-center rounded-lg text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <Menu className="h-6 w-6" aria-hidden />
        </button>

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
          {adminRole === 'super_admin' ? (
            <Suspense fallback={null}>
              <TestLiveToggle />
            </Suspense>
          ) : null}
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
                  {tSettings('logout')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />

      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-[50] lg:hidden transition-opacity duration-200',
          openMenu ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setOpenMenu(false)}
        aria-hidden
      />

      {/* Single sidebar tree: off-canvas on small screens, fixed rail on lg (no duplicate nav DOM). */}
      <aside
        className={cn(
          'fixed start-0 flex flex-col bg-[var(--color-surface-1)] border-e border-[var(--color-border)]',
          'z-[60] lg:z-20 w-64 lg:w-56',
          'top-0 h-full lg:h-auto lg:bottom-0',
          desktopTop,
          'transition-transform duration-200 ease-in-out',
        )}
        style={{
          transform: shouldInertSidebar
            ? locale === 'ar'
              ? 'translateX(100%)'
              : 'translateX(-100%)'
            : 'translateX(0)',
        }}
        {...(shouldInertSidebar ? { inert: true } : {})}
      >
        <div className="p-4 border-b border-[var(--color-border)] shrink-0 lg:bg-[var(--color-surface-2)] flex items-start justify-between gap-2">
          <div>
            <h2 className="font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
            <Link
              href="/dashboard"
              onClick={afterNavigate}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mt-1 block"
            >
              {t('backToMyCenter')}
            </Link>
          </div>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpenMenu(false)}
            className="lg:hidden -me-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] transition-colors shrink-0"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {/* ── Free-floating items (always visible, never inside an accordion) ── */}
          {canSee('overview') ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link
              href={'/admin' as any}
              onClick={afterNavigate}
              className={cn(navBtnClass(isOverviewActive), 'no-underline')}
            >
              <LayoutDashboard size={18} className="shrink-0" />
              <span>{t('overview')}</span>
            </Link>
          ) : null}

          {canSee('ceo_dashboard') ? (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link
              href={'/ceo-dashboard' as any}
              onClick={afterNavigate}
              className={cn(navBtnClass(isCeoDashActive), 'no-underline')}
            >
              <BarChart3 size={18} className="shrink-0" />
              <span>{t('ceoDashboard')}</span>
            </Link>
          ) : null}

          {/* ── Collapsible accordion sections ── */}
          {sections.map((section) => {
            const visibleItems = section.items.filter((item) => item.canShow);
            if (visibleItems.length === 0) return null;

            const isOpen = openSections.has(section.key);
            const contentId = `admin-sidebar-section-${section.key}`;

            return (
              <div key={section.key} className="pt-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleSection(section.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1"
                >
                  <span className="flex-1 text-start">
                    {t(section.labelKey as Parameters<typeof t>[0])}
                  </span>
                  <ChevronRight
                    size={14}
                    className={cn('shrink-0 transition-transform duration-200', isOpen && 'rotate-90')}
                  />
                </button>
                <div
                  id={contentId}
                  className={cn(
                    'overflow-hidden transition-[max-height] duration-[250ms] ease-in-out',
                    isOpen ? 'max-h-[600px]' : 'max-h-0',
                  )}
                >
                  <div className="space-y-0.5 pt-0.5 pb-0.5">
                    {visibleItems.map((item) => renderNavItem(item))}
                  </div>
                </div>
              </div>
            );
          })}
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
