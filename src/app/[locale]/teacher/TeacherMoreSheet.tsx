'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Lock, LogOut, type LucideIcon } from 'lucide-react';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

export type MoreSheetItem = {
  key: string;
  icon: LucideIcon;
  route: string;
  locked: boolean;
  active: boolean;
};

/**
 * The mobile "More" tab's sheet. The design's five-tab bar collapses five nav
 * destinations behind one tab but draws no screen for what opens; this is that
 * screen, built in the design's own card language (see flagged F3).
 *
 * It also carries Log out. That button used to live in a mobile-only top
 * header, which the design does not draw — the sidebar copy is `md:flex`, so
 * deleting the header without relocating it would leave mobile with no way to
 * sign out at all.
 */
export default function TeacherMoreSheet({
  items,
  onNavigate,
  onClose,
}: {
  items: MoreSheetItem[];
  onNavigate: (route: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('teacherPortal.nav');
  const locale = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 md:hidden"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('more')}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 flex flex-col gap-1 rounded-t-[var(--radius-xl)] border-t border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 pb-8 shadow-xl"
      >
        <span
          className="mx-auto mb-2 h-1 w-10 rounded-[var(--radius-pill)] bg-[var(--color-surface-4)]"
          aria-hidden
        />
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={[
                'flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-start text-sm font-semibold transition-colors',
                item.active
                  ? 'bg-[var(--color-mint)] text-[var(--color-teal-deep)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
                item.locked ? 'opacity-55' : '',
              ].join(' ')}
            >
              <Icon size={18} aria-hidden />
              <span className="flex-1">{t(item.key)}</span>
              {item.locked && <Lock size={14} className="text-[var(--color-brass)]" aria-hidden />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => signOutToLogin(locale)}
          className="mt-1 flex w-full items-center gap-3 rounded-[var(--radius-md)] border-t border-[var(--color-hairline)] px-3 py-3 pt-4 text-start text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          <LogOut size={18} aria-hidden />
          <span className="flex-1">{t('logout')}</span>
        </button>
      </div>
    </div>
  );
}
