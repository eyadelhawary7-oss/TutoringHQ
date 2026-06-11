'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import Sidebar from '@/components/Sidebar';
import MobileTopBar from '@/components/MobileTopBar';
import { BottomTabBar } from '@/components/shell/BottomTabBar';
import { MobileWrapper } from '@/components/shell/MobileWrapper';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { CardOrderCartProvider } from '@/hooks/useCardOrderCart';
import { Globe } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRouter } from '@/i18n/routing';
import { PastDueBanner } from '@/components/billing/PastDueBanner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { isRefreshTokenNotFoundError } from '@/lib/supabaseRefreshSilence';

const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/terms',
  '/privacy',
  '/legal',
  '/login',
  '/signup',
  '/forgot-password',
  '/onboarding',
  '/suspended',
  '/reactivate',
  '/session-expired',
  '/auth/callback',
  '/status',
  '/accept-invite',
  '/join',
  // Public marketing surfaces - these must render their own minimal header only
  // (CenterHQ wordmark + Log in), never the authenticated app shell (top nav,
  // sidebar, bottom tab bar), even when a logged-in center owner visits them.
  // The authenticated teacher portal lives at /teacher/(portal)/* (renders at
  // /teacher, /teacher/settings, ...) so /teacher/landing does not over-match it.
  '/center',
  '/teacher/landing',
  '/teacher/signup',
];
function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

const PAGE_TITLE_MAP: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/students': 'nav.students',
  '/payments': 'nav.payments',
  '/billing': 'billing.sub.title',
  '/attendance': 'nav.attendance',
  '/groups': 'nav.groups',
  '/rooms': 'nav.rooms',
  '/schedule': 'nav.schedule',
  '/academic': 'nav.academic',
  '/branches': 'nav.branches',
  '/settings': 'nav.settings',
  '/orders': 'cardOrders.ordersTitle',
  '/notifications': 'notifications.pageTitle',
  '/scan': 'nav.scanner',
  '/whatsapp-pack': 'nav.whatsappPack',
  '/whatsapp': 'nav.whatsappTemplates',
  '/admin': 'nav.admin',
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const isArLocale = locale === 'ar' || locale.startsWith('ar-');
  const router = useRouter();
  const { user } = useUser();
  const [openMenu, setOpenMenu] = useState(false);

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

  const closeMainSidebar = useCallback(() => {}, []);
  const { hideShell, scannerKioskLocked } = useLayout();
  const [isPending, startTransition] = useTransition();

  const cleanPath = stripLocale(pathname);
  const isScanRoute = cleanPath === '/scan' || cleanPath.startsWith('/scan/');
  const kioskChromeHidden = isScanRoute && scannerKioskLocked;
  const isPublic = PUBLIC_PATHS.some((p) => cleanPath === p || cleanPath.startsWith(p + '/'));
  const isAdminRoute =
    cleanPath === '/admin' ||
    cleanPath.startsWith('/admin/') ||
    cleanPath === '/ceo' ||
    cleanPath.startsWith('/ceo/') ||
    cleanPath === '/ceo-dashboard' ||
    cleanPath.startsWith('/ceo-dashboard/');
  const showShell = !isPublic && !hideShell;

  const pageTitleKey =
    PAGE_TITLE_MAP[cleanPath] ??
    (cleanPath.startsWith('/orders/checkout') ? 'checkout.pageTitle' : 'nav.dashboard');
  const pageTitle = t(pageTitleKey);

  const handleLocaleToggle = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
    });
    (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error && isRefreshTokenNotFoundError(error)) return;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        fetch('/api/user/locale', {
          method: 'POST',
          headers,
          body: JSON.stringify({ locale: newLocale }),
        }).catch(() => undefined);
      } catch (e) {
        if (!isRefreshTokenNotFoundError(e)) {
          console.error('Locale sync failed:', e);
        }
      }
    })();
  };

  // Public pages (landing, login, signup, etc) - render children only
  if (!showShell && isPublic) {
    return <>{children}</>;
  }

  // Scanner fullscreen mode (hideShell=true)
  if (!showShell) {
    return (
      <main className="min-h-screen w-full bg-[var(--color-surface-0)]">
        {children}
      </main>
    );
  }

  const shellBody = (
    <div className="flex min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)]">
      {!isAdminRoute && !kioskChromeHidden && (
        <Sidebar mobileDrawerOpen={openMenu} onClose={() => setOpenMenu(false)} />
      )}

      <div
        className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isAdminRoute || kioskChromeHidden ? '' : isArLocale ? 'lg:ms-72' : 'lg:ms-60'} transition-[margin] duration-300`}
      >
        {/* Admin routes render their own <AdminHeader />; AppShell suppresses its desktop header there to prevent a duplicate 56px strip. */}
        {!isAdminRoute && !kioskChromeHidden && (
          <header className="hidden lg:flex items-center h-14 px-6 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shrink-0 sticky top-0 z-30 justify-end">
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <button
                onClick={handleLocaleToggle}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
              >
                <Globe size={14} />
                <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
              </button>
              {user && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground bg-teal-600">
                    {(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
            </div>
          </header>
        )}

        {/* Mobile TopBar - hamburger opens left drawer (not desktop sidebar) */}
        {!isAdminRoute && !kioskChromeHidden && <MobileTopBar openMenu={openMenu} setOpenMenu={setOpenMenu} />}

        {openMenu && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setOpenMenu(false)}
            aria-hidden
          />
        )}
        {/* Page content - scroll + safe-area padding on inner wrapper (MobileWrapper) */}
        <main className="flex-1 flex flex-col min-h-0">
          {!isAdminRoute && !kioskChromeHidden ? <PastDueBanner /> : null}
          <MobileWrapper fullWidth={isAdminRoute}>{children}</MobileWrapper>
        </main>
      </div>

      {!isAdminRoute && !kioskChromeHidden && (
        <div className="lg:hidden">
          <BottomTabBar />
        </div>
      )}
    </div>
  );

  return (
    <SidebarProvider closeMainSidebar={closeMainSidebar}>
      {!isAdminRoute ? (
        // Mount the cart provider regardless of user.center_id readiness - the
        // provider already skips its SWR fetch when user?.center_id is null
        // (see useCardOrderCart.tsx: swrKey = user?.id && user?.center_id ? … : null).
        // Without this, a render-phase race (most reliably observable on the
        // /ar locale path where RTL hydration ordering surfaces it) lets the
        // /students page call useCardOrderCart() before UserContext populates
        // center_id, throwing "must be used within CardOrderCartProvider".
        <CardOrderCartProvider>{shellBody}</CardOrderCartProvider>
      ) : (
        shellBody
      )}
    </SidebarProvider>
  );
}
