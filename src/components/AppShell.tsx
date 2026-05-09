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
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { BottomTabBar } from '@/components/shell/BottomTabBar';
import { MobileWrapper } from '@/components/shell/MobileWrapper';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { Globe } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/onboarding',
  '/suspended',
  '/session-expired',
  '/auth/callback',
  '/status',
  '/accept-invite',
  '/join',
];
function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

const PAGE_TITLE_MAP: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/students': 'nav.students',
  '/payments': 'nav.payments',
  '/attendance': 'nav.attendance',
  '/groups': 'nav.groups',
  '/rooms': 'nav.rooms',
  '/schedule': 'nav.schedule',
  '/academic': 'nav.academic',
  '/branches': 'nav.branches',
  '/settings': 'nav.settings',
  '/orders': 'cardOrders.ordersTitle',
  '/scan': 'nav.scanner',
  '/whatsapp-pack': 'nav.whatsappPack',
  '/admin': 'nav.admin',
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
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

  const pageTitleKey = PAGE_TITLE_MAP[cleanPath] || 'nav.dashboard';
  const pageTitle = t(pageTitleKey);

  const handleLocaleToggle = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
    });
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch('/api/user/locale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locale: newLocale }),
      }).catch(() => undefined);
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

  return (
    <SidebarProvider closeMainSidebar={closeMainSidebar}>
    <div className="flex min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)]">
      {!isAdminRoute && !kioskChromeHidden && <Sidebar onClose={closeMainSidebar} />}

      <div
        className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isAdminRoute || kioskChromeHidden ? '' : 'lg:ms-60 transition-[margin] duration-300'}`}
      >
        <header
          className={`hidden lg:flex items-center h-14 px-6 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shrink-0 sticky top-0 z-30 ${
            isAdminRoute ? 'justify-between' : 'justify-end'
          }`}
        >
          {isAdminRoute ? (
            <div className="flex items-center gap-3">
              <span
                className="text-lg"
                style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
              >
                <span className="text-[var(--color-text-primary)]">CENTER</span>
                <span className="text-teal-600">HQ</span>
              </span>
            </div>
          ) : null}
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

        {/* Mobile TopBar - hamburger opens left drawer (not desktop sidebar) */}
        {!isAdminRoute && !kioskChromeHidden && <MobileTopBar openMenu={openMenu} setOpenMenu={setOpenMenu} />}

        {openMenu && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setOpenMenu(false)}
            aria-hidden
          />
        )}
        {!isAdminRoute && !kioskChromeHidden && <MobileNavDrawer open={openMenu} onClose={() => setOpenMenu(false)} />}

        {/* Page content - scroll + safe-area padding on inner wrapper (MobileWrapper) */}
        <main className="flex-1 flex flex-col min-h-0">
          <MobileWrapper fullWidth={isAdminRoute}>{children}</MobileWrapper>
        </main>
      </div>

      {!isAdminRoute && !kioskChromeHidden && (
        <div className="lg:hidden">
          <BottomTabBar />
        </div>
      )}
    </div>
    </SidebarProvider>
  );
}
