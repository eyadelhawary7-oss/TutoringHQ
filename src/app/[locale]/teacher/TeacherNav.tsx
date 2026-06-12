'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Home,
  Building2,
  CalendarDays,
  LineChart,
  Users,
  UserRound,
  ClipboardList,
  Settings,
  Lock,
  LogOut,
  Menu,
  ChevronRight,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

/**
 * Teacher portal navigation - persistent sidebar on desktop, bottom tab bar on
 * mobile. Mirrors the center sidebar's structure but teacher-branded (cream /
 * teal active / brass locks, ADR 031).
 *
 * Every item routes to its own page (no anchor scrolling). Free-zone locked
 * items (income, groups, students, billing) still navigate - the URL updates so
 * teachers can bookmark and return - and the destination page renders its own
 * locked / upsell state.
 *
 * Desktop sidebar collapses to an icon-only rail (48px); the parent shell owns
 * the `collapsed` state so it can match the main content's start margin.
 */

type NavItem = {
  key: string;
  icon: LucideIcon;
  route: string;
  /** Locks in the free zone (only available with the private engine). */
  lockable?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', icon: Home, route: '/teacher' },
  // Always unlocked: schedule is a Standard feature; the portal layout gate
  // already covers lapsed teachers.
  { key: 'schedule', icon: CalendarDays, route: '/teacher/schedule' },
  { key: 'centers', icon: Building2, route: '/teacher/centers' },
  { key: 'income', icon: LineChart, route: '/teacher/income', lockable: true },
  { key: 'groups', icon: Users, route: '/teacher/groups', lockable: true },
  { key: 'students', icon: UserRound, route: '/teacher/students', lockable: true },
  { key: 'billing', icon: ClipboardList, route: '/teacher/billing', lockable: true },
  { key: 'settings', icon: Settings, route: '/teacher/settings' },
];

// Compact subset for the mobile bottom tab bar.
const MOBILE_KEYS = ['home', 'schedule', 'centers', 'income', 'groups', 'settings'];

export default function TeacherNav({
  privateAccess,
  collapsed,
  onToggleCollapse,
}: {
  privateAccess: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const t = useTranslations('teacherPortal.nav');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  // Collapsed rail expands toward the inline-end (content) direction; mirror
  // the chevron per locale, the same way the codebase mirrors back arrows.
  const ExpandIcon = locale === 'ar' ? ChevronLeft : ChevronRight;

  const isLocked = (item: NavItem) => Boolean(item.lockable) && !privateAccess;

  const isActive = (item: NavItem) =>
    item.route === '/teacher' ? pathname === '/teacher' : pathname.startsWith(item.route);

  // Locked items still navigate: the URL updates and the page shows its locked
  // state. No redirect, so the route is bookmarkable.
  const go = (item: NavItem) => router.push(item.route);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          'fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] transition-[width] duration-200 md:flex',
          collapsed ? 'w-12' : 'w-60',
        ].join(' ')}
      >
        <div
          className={[
            'flex h-14 items-center border-b border-[var(--color-border-subtle)]',
            collapsed ? 'justify-center px-0' : 'justify-between px-5',
          ].join(' ')}
        >
          {!collapsed && (
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-[var(--color-text-primary)]">CenterHQ</span>
              <span className="text-sm text-[var(--color-text-muted)]">{t('brandSuffix')}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            className="rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          >
            {collapsed ? <ExpandIcon size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const locked = isLocked(item);
              const active = isActive(item);
              const showTooltip = locked || collapsed;
              return (
                <li key={item.key} className="group relative">
                  <button
                    type="button"
                    onClick={() => go(item)}
                    aria-label={collapsed ? t(item.key) : undefined}
                    className={[
                      'flex w-full items-center rounded-lg border-solid border-s-4 py-2.5 text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                      active
                        ? 'border-[var(--color-teal)] bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
                      locked ? 'opacity-55' : '',
                    ].join(' ')}
                  >
                    <span className="relative">
                      <Icon size={18} aria-hidden />
                      {locked && collapsed && (
                        <Lock
                          size={10}
                          className="absolute -end-1.5 -top-1.5 text-[var(--color-brass)]"
                          aria-hidden
                        />
                      )}
                    </span>
                    {!collapsed && <span className="flex-1 text-start">{t(item.key)}</span>}
                    {!collapsed && locked && (
                      <Lock size={14} className="text-[var(--color-brass)]" aria-hidden />
                    )}
                  </button>
                  {showTooltip && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute start-full top-1/2 z-40 ms-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-xs text-[var(--color-surface-1)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                    >
                      {locked ? t('lockedTooltip') : t(item.key)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[var(--color-border-subtle)] p-2">
          <button
            type="button"
            onClick={() => signOutToLogin(locale)}
            aria-label={collapsed ? t('logout') : undefined}
            className={[
              'flex w-full items-center rounded-lg py-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]',
              collapsed ? 'justify-center px-0' : 'gap-3 px-3',
            ].join(' ')}
          >
            <LogOut size={18} aria-hidden />
            {!collapsed && t('logout')}
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
              onClick={() => go(item)}
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
