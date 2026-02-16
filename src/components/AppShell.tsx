'use client';

import { useState } from 'react';
import { usePathname } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import Sidebar, { SidebarHamburger } from '@/components/Sidebar';
import TopNavbar from '@/components/TopNavbar';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/onboarding', '/suspended', '/auth/callback'];

function stripLocale(path: string): string {
  return path.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { mode, hideShell } = useLayout();

  const cleanPath = stripLocale(pathname);
  const isPublic = PUBLIC_PATHS.some((p) => cleanPath === p || cleanPath.startsWith(p + '/'));
  const showShell = !isPublic && !hideShell;

  if (!showShell && !isPublic) {
    return (
      <main
        className="min-h-screen transition-all duration-200"
        style={{ background: 'var(--bg-base, #070A14)' }}
      >
        {children}
      </main>
    );
  }

  if (!showShell) {
    return <>{children}</>;
  }

  if (mode === 'web') {
    return (
      <>
        <TopNavbar />
        <main
          className="min-h-screen transition-all duration-200"
          style={{
            paddingInlineStart: '0',
            background: 'var(--bg-base, #070A14)',
          }}
        >
          <div className="pt-14 px-4 pb-8">
            {children}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <SidebarHamburger open={sidebarOpen} onToggle={() => setSidebarOpen(o => !o)} />
      <main
        className="min-h-screen transition-all duration-200"
        style={{
          paddingInlineStart: '0',
          background: 'var(--bg-base, #070A14)',
        }}
      >
        <div className="ps-14 pt-4 pb-8">
          {children}
        </div>
      </main>
    </>
  );
}
