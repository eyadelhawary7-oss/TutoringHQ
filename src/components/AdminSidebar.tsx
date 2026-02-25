'use client';

import React from 'react';
import { useRouter, Link } from '@/i18n/routing';
import {
  LayoutDashboard, Building2, CreditCard, FileText, Clock, Users, Target, BarChart3, IdCard,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type AdminTab = 'overview' | 'ceoDashboard' | 'centers' | 'billing' | 'cardOrders' | 'planRequests' | 'pendingSignups' | 'internalTeam' | 'salesPipeline' | 'analytics';

const ADMIN_NAV: { key: AdminTab; icon: React.ElementType; labelKey: string }[] = [
  { key: 'overview', icon: LayoutDashboard, labelKey: 'overview' },
  { key: 'ceoDashboard', icon: BarChart3, labelKey: 'ceoDashboard' },
  { key: 'centers', icon: Building2, labelKey: 'centers' },
  { key: 'billing', icon: CreditCard, labelKey: 'billing' },
  { key: 'planRequests', icon: FileText, labelKey: 'planRequests' },
  { key: 'pendingSignups', icon: Clock, labelKey: 'pendingSignups' },
  { key: 'internalTeam', icon: Users, labelKey: 'internalTeam' },
  { key: 'salesPipeline', icon: Target, labelKey: 'salesPipeline' },
  { key: 'analytics', icon: BarChart3, labelKey: 'analytics' },
];

interface AdminSidebarProps {
  activeTab?: AdminTab | null;
  onTabChange?: (tab: AdminTab) => void;
  activeRoute?: string;
}

export function AdminSidebar({ activeTab, onTabChange, activeRoute }: AdminSidebarProps) {
  const t = useTranslations('admin');
  const router = useRouter();
  const pendingCount = 5; // TODO: replace with real count
  const isCeo = activeRoute?.includes('admin/ceo');
  const isOrders = activeRoute?.includes('admin/orders');

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-e border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="font-bold text-foreground">{t('title')}</h2>
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground mt-1 block">{t('backToMyCenter')}</Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.map(({ key, icon: Icon, labelKey }) => {
            const isActive = key === 'ceoDashboard' ? isCeo : activeTab === key;
            const items = [(
              <button
                key={key}
                onClick={() => {
                  if (key === 'ceoDashboard') {
                    router.push('/admin/ceo');
                    return;
                  }
                  if (isCeo || isOrders) router.push('/admin');
                  onTabChange?.(key);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                  isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon size={18} />
                <span>{t(labelKey)}</span>
              </button>
            )];
            if (key === 'billing') {
              items.push(
                <button
                  key="cardOrders"
                  onClick={() => router.push('/admin/orders')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start',
                    isOrders ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
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
            return items;
          })}
        </nav>
      </aside>

      {/* Mobile tab selector */}
      <div className="md:hidden fixed top-14 start-0 end-0 z-20 bg-card border-b border-border overflow-x-auto scrollbar-hide">
        <div className="flex px-2 py-1.5 gap-1">
          {ADMIN_NAV.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => {
                if (key === 'ceoDashboard') {
                  router.push('/admin/ceo');
                  return;
                }
                if (isCeo || isOrders) router.push('/admin');
                onTabChange?.(key);
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                (key === 'ceoDashboard' ? isCeo : activeTab === key) ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon size={14} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
          <button
            onClick={() => router.push('/admin/orders')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              isOrders ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
          >
            <IdCard size={14} />
            <span>{t('cardOrders')}</span>
            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">5</span>
          </button>
        </div>
      </div>
    </>
  );
}
