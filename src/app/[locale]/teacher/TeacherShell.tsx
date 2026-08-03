'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import TeacherNav from './TeacherNav';
import TeacherTrialBanner from './TeacherTrialBanner';
import { hidesTeacherTabBar } from './teacherChrome';
import { NudgeBanner } from '@/components/billing/NudgeBanner';

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
  const locale = useLocale();
  const pathname = usePathname();
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

      {/* The design draws no mobile brand/logout header - each screen opens on
          its own appbar (TeacherAppBar). Log out moved to the More sheet, which
          is now mobile's only sign-out (the sidebar copy is md:flex). */}

      <main
        className={[
          'w-full transition-[padding] duration-200 md:pb-6',
          hidesTeacherTabBar(pathname) ? 'pb-6' : 'pb-24',
          collapsed ? 'md:ps-12' : 'md:ps-60',
        ].join(' ')}
      >
        <NudgeBanner />
        <TeacherTrialBanner privateAccess={privateAccess} />
        <div className="mx-auto w-full max-w-3xl p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
