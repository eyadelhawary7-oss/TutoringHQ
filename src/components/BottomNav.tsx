'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import type { PermissionKey } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  QrCode,
  Users,
  CreditCard,
  X,
  MoreHorizontal,
  LogOut,
  BookOpen,
  DoorOpen,
  Calendar,
  Settings,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const primaryItems: { key: string; path: string; icon: React.ElementType; permission?: PermissionKey }[] = [
  { key: 'dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'can_view_dashboard' },
  { key: 'scanner', path: '/scan', icon: QrCode, permission: 'can_scan' },
  { key: 'students', path: '/students', icon: Users, permission: 'can_manage_students' },
  { key: 'payments', path: '/payments', icon: CreditCard, permission: 'can_view_payments' },
];

const moreItems: { key: string; path: string; icon: React.ElementType; permission?: PermissionKey; ownerAdminOnly?: boolean }[] = [
  { key: 'groups', path: '/groups', icon: BookOpen, permission: 'can_manage_groups' },
  { key: 'rooms', path: '/rooms', icon: DoorOpen, ownerAdminOnly: true },
  { key: 'schedule', path: '/schedule', icon: Calendar, permission: 'can_view_schedule' },
  { key: 'settings', path: '/settings', icon: Settings, permission: 'can_view_settings' },
];

export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const [showMore, setShowMore] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setIsAdmin(!!data?.isAdmin);
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  const stripLocale = (p: string) => p.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
  const cleanPath = stripLocale(pathname);

  const visiblePrimaryItems = user
    ? primaryItems.filter((item) => {
        if (user.role === 'owner' || user.role === 'admin') return true;
        if (!item.permission) return true;
        return hasPermission(item.permission);
      })
    : primaryItems;

  const visibleMoreItems = user
    ? moreItems.filter((item) => {
        if (item.ownerAdminOnly) return user.role === 'owner' || user.role === 'admin';
        if (user.role === 'owner' || user.role === 'admin') return true;
        if (!item.permission) return true;
        return hasPermission(item.permission);
      })
    : [];

  const isActive = (path: string) =>
    cleanPath === path || cleanPath.startsWith(path + '/');

  const handleLogout = async () => {
    setShowMore(false);
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <>
      {/* Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 start-0 end-0 z-50 border-t border-border print:hidden" style={{ background: 'hsl(var(--card))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-stretch h-14">
          {visiblePrimaryItems.map(({ key, path, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link
                key={path}
                href={path}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon size={20} className={cn(active && 'text-primary')} />
                <span className="text-[10px]">{t(key)}</span>
              </Link>
            );
          })}
          {/* More button */}
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground"
          >
            <MoreHorizontal size={20} />
            <span className="text-[10px]">{t('more')}</span>
          </button>
        </div>
      </nav>

      {/* More slide-up sheet */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-[60] print:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 start-0 end-0 rounded-t-2xl border-t border-border p-4 pb-8"
            style={{ background: 'hsl(var(--card))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">{t('more')}</h3>
              <button onClick={() => setShowMore(false)} className="p-1 rounded-lg hover:bg-muted">
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {visibleMoreItems.map(({ key, path, icon: Icon }) => {
                const active = isActive(path);
                return (
                  <Link
                    key={path}
                    href={path}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                      active
                        ? 'border-primary/30 bg-primary/5 text-primary'
                        : 'border-border text-foreground hover:bg-muted'
                    )}
                  >
                    <Icon size={20} />
                    <span className="font-medium text-sm">{t(key)}</span>
                  </Link>
                );
              })}
            </div>
            {isAdmin && (
              <Link
                href="/admin"
                onClick={() => setShowMore(false)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border transition-colors mt-3',
                  cleanPath.startsWith('/admin')
                    ? 'border-primary/30 bg-primary/5 text-primary'
                    : 'border-border text-foreground hover:bg-muted'
                )}
              >
                <Shield size={20} />
                <span className="font-medium text-sm">{t('admin')}</span>
              </Link>
            )}
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border p-3 text-sm font-medium text-destructive hover:bg-muted transition-colors"
              >
                <LogOut size={20} />
                <span>{t('logout')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
