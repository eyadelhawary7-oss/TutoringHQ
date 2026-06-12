'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useLayout } from '@/contexts/LayoutContext';
import { signOutToLogin } from '@/lib/auth/sign-out-client';
import TeacherNav from './TeacherNav';
import TeacherTrialBanner from './TeacherTrialBanner';

/**
 * Teacher portal chrome. Hides the center-app shell (sidebar/topbar) the same
 * way the admin tool pages do, then renders a teacher-branded sidebar
 * (TeacherNav) on desktop and a bottom tab bar on mobile. The portal grows
 * inside <main>.
 */
export default function TeacherShell({
  privateAccess,
  children,
}: {
  privateAccess: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('teacherPortal');
  const locale = useLocale();
  const { setHideShell } = useLayout();

  // Desktop sidebar collapse. In-memory only - resetting to expanded on a fresh
  // navigation is fine and avoids any browser storage.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  return (
    <div
      className="min-h-screen w-full bg-[var(--color-surface-0)]"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <TeacherNav
        privateAccess={privateAccess}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      {/* Mobile-only top header (the desktop brand + logout live in the
          sidebar). */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 md:hidden">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-[var(--color-text-primary)]">CenterHQ</span>
          <span className="text-sm text-[var(--color-text-muted)]">{t('headerTitle')}</span>
        </div>
        <button
          onClick={() => signOutToLogin(locale)}
          aria-label={t('logout')}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-0)]"
        >
          <LogOut size={14} aria-hidden />
          <span className="hidden sm:inline">{t('logout')}</span>
        </button>
      </header>

      <main
        className={[
          'w-full pb-24 transition-[padding] duration-200 md:pb-6',
          collapsed ? 'md:ps-12' : 'md:ps-60',
        ].join(' ')}
      >
        <TeacherTrialBanner privateAccess={privateAccess} />
        <div className="mx-auto w-full max-w-3xl p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
