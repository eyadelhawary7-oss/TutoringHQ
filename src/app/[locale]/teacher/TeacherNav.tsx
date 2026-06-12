'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Home,
  Building2,
  LineChart,
  Users,
  UserRound,
  ClipboardList,
  Settings,
  Lock,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

/**
 * Teacher portal navigation - persistent sidebar on desktop, bottom tab bar on
 * mobile. Mirrors the center sidebar's structure but teacher-branded (cream /
 * teal active / brass locks, ADR 031).
 *
 * Free zone (privateAccess = false): the private-engine items (income, groups,
 * students, billing) render muted and locked. Clicking a locked item does NOT
 * navigate - it scrolls the home page to the "Your own private practice" upsell
 * so the teacher lands on the conversion CTA.
 */

type NavItem = {
  key: string;
  icon: LucideIcon;
  /** A real route to navigate to (Home / Settings). */
  route?: string;
  /** A section anchor on the home page to scroll to. */
  sectionId?: string;
  /** Locks in the free zone (only available with the private engine). */
  lockable?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', icon: Home, route: '/teacher' },
  { key: 'centers', icon: Building2, sectionId: 'section-centers' },
  { key: 'income', icon: LineChart, sectionId: 'section-income', lockable: true },
  { key: 'groups', icon: Users, sectionId: 'section-groups', lockable: true },
  { key: 'students', icon: UserRound, sectionId: 'section-groups', lockable: true },
  { key: 'billing', icon: ClipboardList, sectionId: 'section-groups', lockable: true },
  { key: 'settings', icon: Settings, route: '/teacher/settings' },
];

// Compact subset for the mobile bottom tab bar.
const MOBILE_KEYS = ['home', 'centers', 'income', 'groups', 'settings'];

const UPSELL_ID = 'section-upsell';

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export default function TeacherNav({ privateAccess }: { privateAccess: boolean }) {
  const t = useTranslations('teacherPortal.nav');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const isLocked = (item: NavItem) => Boolean(item.lockable) && !privateAccess;

  const isActive = (item: NavItem) => {
    if (item.route === '/teacher') return pathname === '/teacher';
    if (item.route) return pathname.startsWith(item.route);
    return false;
  };

  const handleNav = (item: NavItem) => {
    if (item.route) {
      if (item.route === '/teacher' && pathname === '/teacher') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        router.push(item.route);
      }
      return;
    }

    // Section item. Locked items always land on the upsell; unlocked items
    // scroll to their real section.
    const targetId = isLocked(item) ? UPSELL_ID : item.sectionId;
    if (!targetId) return;
    if (pathname === '/teacher') {
      scrollToId(targetId);
    } else {
      // Different route (settings / a group page): go home, then the home
      // page scrolls to the hash on mount.
      router.push(`/teacher#${targetId}`);
    }
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border-subtle)] px-5">
          <span className="font-bold text-[var(--color-text-primary)]">CenterHQ</span>
          <span className="text-sm text-[var(--color-text-muted)]">{t('brandSuffix')}</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const locked = isLocked(item);
              const active = isActive(item);
              return (
                <li key={item.key} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleNav(item)}
                    aria-disabled={locked}
                    className={[
                      'flex w-full items-center gap-3 rounded-lg border-solid border-s-4 px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'border-[var(--color-teal)] bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                      locked ? 'opacity-55' : '',
                    ].join(' ')}
                  >
                    <Icon size={18} aria-hidden />
                    <span className="flex-1 text-start">{t(item.key)}</span>
                    {locked && (
                      <Lock size={14} className="text-[var(--color-brass)]" aria-hidden />
                    )}
                  </button>
                  {locked && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute start-full top-1/2 z-40 ms-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-surface-1)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                    >
                      {t('lockedTooltip')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[var(--color-border-subtle)] p-3">
          <button
            type="button"
            onClick={() => signOutToLogin(locale)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          >
            <LogOut size={18} aria-hidden />
            {t('logout')}
          </button>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] md:hidden">
        {NAV_ITEMS.filter((i) => MOBILE_KEYS.includes(i.key)).map((item) => {
          const Icon = item.icon;
          const locked = isLocked(item);
          const active = isActive(item);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleNav(item)}
              aria-disabled={locked}
              className={[
                'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                active ? 'text-[var(--color-teal-deep)]' : 'text-[var(--color-text-secondary)]',
                locked ? 'opacity-55' : '',
              ].join(' ')}
            >
              <span className="relative">
                <Icon size={20} aria-hidden />
                {locked && (
                  <Lock
                    size={10}
                    className="absolute -end-1 -top-1 text-[var(--color-brass)]"
                    aria-hidden
                  />
                )}
              </span>
              {t(item.key)}
            </button>
          );
        })}
      </nav>
    </>
  );
}
