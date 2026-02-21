'use client';

import { useState } from 'react';
import { usePathname } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import Sidebar from '@/components/Sidebar';
import MobileTopBar from '@/components/MobileTopBar';
import { BottomNav } from '@/components/BottomNav';
import { Globe, Menu } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/onboarding', '/suspended', '/auth/callback'];
function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

const PAGE_TITLE_MAP: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/students': 'nav.students',
  '/payments': 'nav.payments',
  '/groups': 'nav.groups',
  '/rooms': 'nav.rooms',
  '/schedule': 'nav.schedule',
  '/settings': 'nav.settings',
  '/scan': 'nav.scanner',
  '/admin': 'nav.admin',
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Desktop topbar */}
        <header className="hidden md:flex items-center justify-between h-14 px-6 border-b border-border bg-card shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="font-bold text-foreground text-lg">CenterHQ</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLocaleToggle}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              <Globe size={14} />
              <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
            </button>
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white bg-primary">
                  {(user?.name || user?.phone || 'U').charAt(0).toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Mobile TopBar - includes hamburger */}
        <MobileTopBar onMenuClick={() => setSidebarOpen(true)} />

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          <div className="pt-14 pb-20 ps-4 pe-4 md:pt-6 md:pb-8 md:ps-6 md:pe-6">
            {children}
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
