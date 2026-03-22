'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, Link } from '@/i18n/routing';
import {
  LayoutDashboard, Building2, CreditCard, FileText, Clock, Users, Target, BarChart3, IdCard, Gift, CalendarCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';
import { getAdminPermissions } from '@/lib/admin-roles';
import { supabase } from '@/lib/supabase';

export type AdminTab = 'overview' | 'ceoDashboard' | 'centers' | 'billing' | 'cardOrders' | 'planRequests' | 'pendingSignups' | 'referrals' | 'internalTeam' | 'salesPipeline' | 'analytics';

const ADMIN_NAV: { key: AdminTab; icon: React.ElementType; labelKey: string; permissionKey: string }[] = [
  { key: 'overview', icon: LayoutDashboard, labelKey: 'overview', permissionKey: 'overview' },
  { key: 'ceoDashboard', icon: BarChart3, labelKey: 'ceoDashboard', permissionKey: 'ceo_dashboard' },
  { key: 'centers', icon: Building2, labelKey: 'centers', permissionKey: 'centers' },
  { key: 'billing', icon: CreditCard, labelKey: 'billing', permissionKey: 'billing' },
  { key: 'planRequests', icon: FileText, labelKey: 'planRequests', permissionKey: 'plan_requests' },
  { key: 'pendingSignups', icon: Clock, labelKey: 'pendingSignups', permissionKey: 'pending_signups' },
  { key: 'referrals', icon: Gift, labelKey: 'referrals', permissionKey: 'referrals' },
  { key: 'internalTeam', icon: Users, labelKey: 'internalTeam', permissionKey: 'internal_team' },
  { key: 'salesPipeline', icon: Target, labelKey: 'salesPipeline', permissionKey: 'sales_pipeline' },
  { key: 'analytics', icon: BarChart3, labelKey: 'analytics', permissionKey: 'analytics' },
];

interface AdminSidebarProps {
  activeTab?: AdminTab | null;
  onTabChange?: (tab: AdminTab) => void;
  activeRoute?: string;
}

export function AdminSidebar({ activeTab, onTabChange, activeRoute }: AdminSidebarProps) {
  const t = useTranslations('admin');
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const pendingCount = 5; // TODO: replace with real count
  const isCeo = activeRoute === '/ceo' || activeRoute === '/ceo-dashboard' || activeRoute?.endsWith('/ceo') || activeRoute?.endsWith('/ceo-dashboard');
  const isOrders = activeRoute?.includes('admin/orders');
  const isRenewals = activeRoute?.includes('admin/renewals');
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [customPermissions, setCustomPermissions] = useState<string[]>([]);

  const allowedKeys = adminRole === 'super_admin'
    ? null
    : adminRole
      ? getAdminPermissions(adminRole, customPermissions)
      : null;
  const isSuperAdmin = adminRole === 'super_admin';

  useEffect(() => {
    const loadAdminRole = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data?.isAdmin) {
          setAdminRole(data.role ?? 'admin');
          setCustomPermissions(data.customPermissions ?? []);
        }
      } catch {
        setAdminRole('admin');
      }
    };
    loadAdminRole();
  }, []);

  // Close main nav sidebar when admin panel is active on mobile (prevents two sidebars)
  useEffect(() => {
    if (typeof closeMainSidebar === 'function') {
      closeMainSidebar();
    }
  }, [closeMainSidebar]);

  const canSee = (permissionKey: string) => allowedKeys === null || allowedKeys.includes(permissionKey);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-[var(--color-surface-1)] border-e border-[var(--color-border-default)]">
        <div className="p-4 border-b border-[var(--color-border-default)] bg-[var(--color-surface-2)]">
          <h2 className="font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <Link
            href="/dashboard"
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mt-1 block"
          >
            {t('backToMyCenter')}
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.filter(({ permissionKey }) => canSee(permissionKey)).map(({ key, icon: Icon, labelKey }) => {
            const isActive = key === 'ceoDashboard' ? isCeo : activeTab === key;
            const items = [(
              <button
                key={key}
                onClick={() => {
                  closeMainSidebar?.();
                  if (key === 'ceoDashboard') {
                    router.push('/ceo-dashboard');
                    return;
                  }
                  if (isCeo || isOrders) router.push('/admin');
                  onTabChange?.(key);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                  isActive
                    ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                )}
              >
                <Icon size={18} />
                <span>{t(labelKey)}</span>
              </button>
            )];
            if (key === 'billing') {
              if (canSee('renewals')) {
                items.push(
                  <button
                    key="renewals"
                    onClick={() => { closeMainSidebar?.(); router.push('/admin/renewals'); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isRenewals
                        ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                    )}
                  >
                    <CalendarCheck size={18} />
                    <span>{t('renewals')}</span>
                  </button>
                );
              }
              if (canSee('card_orders')) {
                items.push(
                  <button
                    key="cardOrders"
                    onClick={() => { closeMainSidebar?.(); router.push('/admin/orders'); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                      isOrders
                        ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                    )}
                  >
                    <IdCard size={18} />
                    <span>{t('cardOrders')}</span>
                    {pendingCount > 0 && (
                      <span className="ms-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold px-1.5">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              }
            }
            return items;
          })}
        </nav>
      </aside>

      {/* Mobile tab selector */}
      <div className="md:hidden fixed top-14 start-0 end-0 z-20 bg-[var(--color-surface-1)] border-b border-[var(--color-border-default)] overflow-x-auto scrollbar-hide">
        <div className="flex px-2 py-1.5 gap-1">
          {ADMIN_NAV.filter(({ permissionKey }) => canSee(permissionKey)).map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => {
                closeMainSidebar?.();
                if (key === 'ceoDashboard') {
                  router.push('/ceo-dashboard');
                  return;
                }
                if (isCeo || isOrders) router.push('/admin');
                onTabChange?.(key);
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                (key === 'ceoDashboard' ? isCeo : activeTab === key)
                  ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                  : 'text-[var(--color-text-secondary)]'
              )}
            >
              <Icon size={14} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
          {canSee('renewals') && (
            <button
              onClick={() => { closeMainSidebar?.(); router.push('/admin/renewals'); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                isRenewals
                  ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                  : 'text-[var(--color-text-secondary)]'
              )}
            >
              <CalendarCheck size={14} />
              <span>{t('renewals')}</span>
            </button>
          )}
          {canSee('card_orders') && (
            <button
              onClick={() => { closeMainSidebar?.(); router.push('/admin/orders'); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                isOrders
                  ? 'bg-[rgba(13,148,136,0.12)] text-[var(--color-brand-500)]'
                  : 'text-[var(--color-text-secondary)]'
              )}
            >
              <IdCard size={14} />
              <span>{t('cardOrders')}</span>
              <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">5</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
