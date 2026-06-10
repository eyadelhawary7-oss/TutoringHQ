'use client';

import { useEffect, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut, Settings } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useLayout } from '@/contexts/LayoutContext';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

/**
 * Thin portal chrome. Hides the center-app shell (sidebar/topbar) the same way
 * the admin tool pages do, and renders a minimal header instead. Scaffolding
 * only; the portal grows inside <main>.
 */
export default function TeacherShell({ children }: { children: ReactNode }) {
  const t = useTranslations('teacherPortal');
  const locale = useLocale();
  const { setHideShell } = useLayout();

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  return (
    <div
      className="min-h-screen w-full bg-[var(--color-surface-0)]"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 md:px-6">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-[var(--color-text-primary)]">CenterHQ</span>
          <span className="text-sm text-[var(--color-text-muted)]">{t('headerTitle')}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/teacher/settings"
            aria-label={t('settings')}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-0)]"
          >
            <Settings size={14} />
            <span className="hidden sm:inline">{t('settings')}</span>
          </Link>
          <button
            onClick={() => signOutToLogin(locale)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-0)]"
          >
            <LogOut size={14} />
            {t('logout')}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl p-4 md:p-6">{children}</main>
    </div>
  );
}
