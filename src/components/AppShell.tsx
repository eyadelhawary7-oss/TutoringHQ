'use client';

import { useState, useCallback } from 'react';
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
import { Globe, Menu } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/onboarding', '/suspended', '/auth/callback', '/status'];
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
  '/scan': 'nav.scanner',
  '/admin': 'nav.admin',
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeMainSidebar = useCallback(() => setSidebarOpen(false), []);
  const { hideShell } = useLayout();
  const [isPending, startTransition] = useTransition();

  const cleanPath = stripLocale(pathname);
  const isPublic = PUBLIC_PATHS.some((p) => cleanPath === p || cleanPath.startsWith(p + '/'));
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

  // Public pages (landing, login, signup, etc) — render children only
  if (!showShell && isPublic) {
    return <>{children}</>;
  }

  // Scanner fullscreen mode (hideShell=true)
  if (!showShell) {
    return (
      <main className="min-h-screen bg-background">
        {children}
      </main>
    );
  }

  return (
    <SidebarProvider closeMainSidebar={closeMainSidebar}>
    <div className="flex min-h-screen w-full bg-slate-50">
      <Sidebar open={sidebarOpen} onClose={closeMainSidebar} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden md:ms-64">
        {/* Desktop topbar */}
        <header className="hidden md:flex items-center justify-between h-14 px-6 border-b border-slate-200 bg-white shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="font-bold text-slate-900 text-lg">CenterHQ</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLocaleToggle}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Globe size={14} />
              <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
            </button>
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white bg-teal-600">
                  {(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Mobile TopBar - includes hamburger */}
        <MobileTopBar onMenuClick={() => setSidebarOpen(true)} />

        {/* Page content — scroll + safe-area padding on inner wrapper (MobileWrapper) */}
        <main className="flex-1 flex flex-col min-h-0">
          <MobileWrapper>{children}</MobileWrapper>
        </main>
      </div>

      <BottomTabBar />
    </div>
    </SidebarProvider>
  );
}
