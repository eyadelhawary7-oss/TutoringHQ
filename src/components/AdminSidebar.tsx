'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';
import { getAdminPermissions } from '@/lib/admin-roles';
import { supabase } from '@/lib/supabase';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { useTheme } from 'next-themes';

function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors text-sm"
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      <span style={{ fontSize: 16 }}>{isDark ? '☀️' : '🌙'}</span>
      <span className="hidden xl:block">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
    </button>
  );
}

export type AdminTab =
  | 'overview'
  | 'ceoDashboard'
  | 'centers'
  | 'billing'
  | 'cardOrders'
  | 'planRequests'
  | 'pendingSignups'
  | 'referrals'
  | 'withdrawals'
  | 'internalTeam'
  | 'salesPipeline'
  | 'analytics';

const ADMIN_NAV: { key: AdminTab; icon: React.ElementType; labelKey: string; permissionKey: string }[] = [
  { key: 'overview', icon: LayoutDashboard, labelKey: 'overview', permissionKey: 'overview' },
  { key: 'ceoDashboard', icon: BarChart3, labelKey: 'ceoDashboard', permissionKey: 'ceo_dashboard' },
  { key: 'centers', icon: Building2, labelKey: 'centers', permissionKey: 'centers' },
  { key: 'billing', icon: CreditCard, labelKey: 'billing', permissionKey: 'billing' },
  { key: 'planRequests', icon: FileText, labelKey: 'planRequests', permissionKey: 'plan_requests' },
  { key: 'pendingSignups', icon: Clock, labelKey: 'pendingSignups', permissionKey: 'pending_signups' },
  { key: 'referrals', icon: Gift, labelKey: 'referrals', permissionKey: 'referrals' },
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

  const pendingCount = 5; // TODO: replace with real count
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

  const allowedKeys =
    adminRole === 'super_admin' ? null : adminRole ? getAdminPermissions(adminRole, customPermissions) : null;

  const canSee = useCallback(
    (permissionKey: string) => allowedKeys === null || allowedKeys.includes(permissionKey),
    [allowedKeys],
  );

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
      router.push('/ceo-dashboard');
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
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
      active
        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white',
    );

  const desktopAsideTop = desktopSidebarFullHeight ? 'top-0' : 'top-14';

  return (
    <>
      {/* Mobile top bar — matches center shell pattern */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] min-h-14 flex items-center justify-center print:hidden relative px-4">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 lg:hidden">
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
          <span className="font-bold text-sm text-[var(--color-text-primary)]">CenterHQ</span>
        </Link>

        <div
          className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2"
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
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
            >
              {(userName || userPhone || 'U').charAt(0).toUpperCase()}
            </button>
            {isUserMenuOpen ? (
              <div className="absolute top-12 left-0 bg-[var(--color-surface-1)] rounded-xl shadow-lg border border-[var(--color-border-subtle)] py-1 z-50 min-w-[200px]">
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{userName || '—'}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]" dir="ltr">
                    {userPhone || '—'}
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
                  تغيير الرمز السري
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
        className={`fixed top-0 left-0 h-full w-64 z-[60] lg:hidden flex flex-col bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 transition-transform duration-[250ms] ease-in-out ${
          openMenu ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!openMenu}
      >
        <div className="p-4 border-b border-gray-200 dark:border-slate-800 shrink-0">
          <Link
            href="/dashboard"
            onClick={afterNavigate}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white block mb-3"
          >
            {t('backToMyCenter')}
          </Link>
          <h2 className="font-bold text-slate-900 dark:text-white">{t('title')}</h2>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.filter(({ permissionKey }) => canSee(permissionKey)).map(({ key, icon: Icon, labelKey }) => {
            const isActive =
              key === 'ceoDashboard'
                ? isCeo
                : key === 'withdrawals'
                  ? isWithdrawals
                  : key === 'referrals'
                    ? isReferrals
                    : activeTab === key;
            const items: React.ReactNode[] = [
              <button
                key={key}
                type="button"
                onClick={() => runPrimaryNav(key)}
                className={drawerBtn(!!isActive)}
              >
                <Icon size={18} className="shrink-0" />
                <span>{t(labelKey as Parameters<typeof t>[0])}</span>
              </button>,
            ];
            if (key === 'billing') {
              if (canSee('renewals')) {
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
              if (canSee('card_orders')) {
                items.push(
                  <button
                    key="cardOrders"
                    type="button"
                    onClick={() => {
                      afterNavigate();
                      router.push('/admin/orders');
                    }}
                    className={drawerBtn(!!isOrders)}
                  >
                    <IdCard size={18} className="shrink-0" />
                    <span>{t('cardOrders')}</span>
                    {pendingCount > 0 ? (
                      <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-600 text-white text-[11px] font-bold px-1.5">
                        {pendingCount}
                      </span>
                    ) : null}
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
                    <span>{t('vendors')}</span>
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
        </nav>
        <div className="shrink-0 p-2 border-t border-gray-200 dark:border-slate-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed left-0 w-56 z-20 bg-white dark:bg-slate-900 border-e border-gray-200 dark:border-slate-700 bottom-0',
          desktopAsideTop,
        )}
      >
        <div className="p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('title')}</h2>
          <Link
            href="/dashboard"
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mt-1 block"
          >
            {t('backToMyCenter')}
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.filter(({ permissionKey }) => canSee(permissionKey)).map(({ key, icon: Icon, labelKey }) => {
            const isActive =
              key === 'ceoDashboard'
                ? isCeo
                : key === 'withdrawals'
                  ? isWithdrawals
                  : key === 'referrals'
                    ? isReferrals
                    : activeTab === key;
            const items: React.ReactNode[] = [
              <button
                key={key}
                type="button"
                onClick={() => {
                  closeMainSidebar?.();
                  if (key === 'ceoDashboard') {
                    router.push('/ceo-dashboard');
                    return;
                  }
                  if (key === 'withdrawals') {
                    router.push('/admin/withdrawals');
                    return;
                  }
                  if (key === 'referrals') {
                    router.push('/admin/referrals');
                    return;
                  }
                  if (isCeo || isOrders) router.push('/admin');
                  onTabChange?.(key);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                  isActive
                    ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                <Icon size={18} />
                <span>{t(labelKey as Parameters<typeof t>[0])}</span>
              </button>,
            ];
            if (key === 'billing') {
              if (canSee('renewals')) {
                items.push(
                  <button
                    key="renewals"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/renewals');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isRenewals
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isPricing
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isPlatformConfig
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <Settings size={18} />
                    <span>{t('platformConfigNav')}</span>
                  </button>,
                );
              }
              if (canSee('card_orders')) {
                items.push(
                  <button
                    key="cardOrders"
                    type="button"
                    onClick={() => {
                      closeMainSidebar?.();
                      router.push('/admin/orders');
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isOrders
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <IdCard size={18} />
                    <span>{t('cardOrders')}</span>
                    {pendingCount > 0 ? (
                      <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold px-1.5">
                        {pendingCount}
                      </span>
                    ) : null}
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isVendors
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <Truck size={18} />
                    <span>{t('vendors')}</span>
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isWaPack
                        ? 'bg-teal-50 dark:bg-slate-700 text-teal-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
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
        </nav>
        <div className="shrink-0 p-2 border-t border-gray-200 dark:border-slate-700">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
