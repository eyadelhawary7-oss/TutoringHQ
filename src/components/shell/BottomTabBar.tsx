'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey } from '@/contexts/UserContext';
import { LayoutDashboard, QrCode, Users } from 'lucide-react';

type TabDef = {
  navKey: string
  path: string
  segment: string
  icon: typeof LayoutDashboard
  permission?: PermissionKey
}

const TABS: TabDef[] = [
  {
    navKey: 'dashboard',
    path: '/dashboard',
    segment: 'dashboard',
    icon: LayoutDashboard,
    permission: 'can_view_dashboard',
  },
  { navKey: 'scanner', path: '/scan', segment: 'scan', icon: QrCode, permission: 'can_scan' },
  {
    navKey: 'students',
    path: '/students',
    segment: 'students',
    icon: Users,
    permission: 'can_manage_students',
  },
];

function stripLocale(p: string) {
  return p.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

/** Exact path segment match — e.g. ceo-dashboard does not activate dashboard tab */
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
        if (user.role === 'owner' || user.role === 'admin') return true;
        if (!tab.permission) return true;
        return hasPermission(tab.permission);
      })
    : TABS;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 print:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-[0_-1px_0_rgba(0,0,0,0.06)] dark:shadow-none transition-colors duration-150"
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
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1 min-w-0 transition-colors duration-150 ${active ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}
            >
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
              <span
                className={`text-[0.625rem] font-semibold leading-none truncate max-w-full transition-colors duration-150 ${active ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-slate-400'}`}
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
