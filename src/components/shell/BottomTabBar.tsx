'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey } from '@/contexts/UserContext';
import { ClipboardCheck, CreditCard, House, Users } from 'lucide-react';

type TabDef = {
  navKey: string
  path: string
  segment: string
  icon: typeof Users
  permission?: PermissionKey
}

/**
 * Merged-Center-Students §01 `.tabbar` — FOUR tabs, in this order:
 *   Home (house) · Students (users) · Attend (clipboard-check) · Fees (card)
 *
 * Live carried three (Dashboard / Attendance / Students) with a QR glyph on
 * attendance and no route to money at all. `/payments` is already listed in
 * AUTHENTICATED_ROUTE_PREFIXES (src/proxy.ts), so adding the tab needs no
 * proxy change.
 */
const TABS: TabDef[] = [
  {
    navKey: 'home',
    path: '/dashboard',
    segment: 'dashboard',
    icon: House,
    permission: 'can_view_dashboard',
  },
  {
    navKey: 'students',
    path: '/students',
    segment: 'students',
    icon: Users,
    permission: 'can_manage_students',
  },
  { navKey: 'attend', path: '/attendance', segment: 'attendance', icon: ClipboardCheck, permission: 'can_scan' },
  { navKey: 'fees', path: '/payments', segment: 'payments', icon: CreditCard, permission: 'can_view_payments' },
];

function stripLocale(p: string) {
  return p.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

/** Exact path segment match - e.g. ceo-dashboard does not activate dashboard tab */
function isTabActive(cleanPath: string, segment: string) {
  return cleanPath.split('/').filter(Boolean).includes(segment);
}

export function BottomTabBar() {
  const t = useTranslations('nav');
  const tm = useTranslations('mobileShell');
  const pathname = usePathname();
  const { user, hasPermission } = useUser();
  const cleanPath = stripLocale(pathname);

  const visibleTabs = user
    ? TABS.filter((tab) => {
        if (user.role === 'owner' || user.role === 'admin' || user.role === 'super_admin') return true;
        if (!tab.permission) return true;
        return hasPermission(tab.permission);
      })
    : TABS;

  return (
    <nav
      className="md:hidden fixed bottom-0 start-0 end-0 z-40 print:hidden bg-[var(--color-surface-1)] border-t border-[var(--color-border)] shadow-none transition-colors duration-150"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label={tm('tab_bar_label')}
    >
      <div className="flex items-stretch min-h-14 h-14">
        {visibleTabs.map(({ navKey, path, segment, icon: Icon }) => {
          const active = isTabActive(cleanPath, segment);
          return (
            <Link
              key={path}
              href={path}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1 min-w-0 transition-colors duration-150 ${active ? 'text-teal-600' : 'text-[var(--color-text-muted)]'}`}
            >
              {/* §01 `.tab.on .ic { border-radius:8px; background:#0E6B61; color:#fff }`
                  — the active tab is a filled pill behind the glyph, not just
                  teal ink. The label stays teal. */}
              <span
                className={`flex h-[26px] w-[26px] items-center justify-center transition-colors duration-150 ${
                  active ? 'rounded-lg bg-[#0E6B61] text-white' : ''
                }`}
              >
                <Icon size={active ? 18 : 22} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
              </span>
              <span
                className={`text-[0.625rem] font-semibold leading-none truncate max-w-full transition-colors duration-150 ${active ? 'text-teal-600' : 'text-[var(--color-text-muted)]'}`}
              >
                {t(navKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
