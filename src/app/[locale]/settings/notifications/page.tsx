'use client';

import { useState, useEffect, useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { MessageCircle, Calendar, ChevronRight } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';

export default function NotificationSettingsPage() {
  const t = useTranslations('settings');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';
  const dailySummarySwitchId = useId();
  const summerSwitchId = useId();

  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(true);
  const [summerModeEnabled, setSummerModeEnabled] = useState(false);

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);
      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        setIsLoading(false);
        return;
      }
      const userCenterId = meData.user.center_id;
      setCenterId(userCenterId);

      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: 'daily_summary_enabled, summer_mode',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });
      if (centerData) {
        const c = centerData as { daily_summary_enabled?: boolean; summer_mode?: boolean };
        setDailySummaryEnabled(c.daily_summary_enabled !== false);
        setSummerModeEnabled(c.summer_mode === true);
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const handleDailySummaryToggle = async (enabled: boolean) => {
    if (!centerId || !userId) return;
    setDailySummaryEnabled(enabled);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { daily_summary_enabled: enabled },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'daily_summary_enabled', value: enabled } });
    } else {
      setDailySummaryEnabled(!enabled);
    }
  };

  const handleSummerModeToggle = async (enabled: boolean) => {
    if (!centerId || !userId) return;
    setSummerModeEnabled(enabled);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { summer_mode: enabled },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'summer_mode', value: enabled } });
    } else {
      setSummerModeEnabled(!enabled);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          <div className="skeleton h-24 rounded-2xl w-full" />
          <div className="skeleton h-24 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('sectionNotifications')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        <div className="space-y-4">
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                <MessageCircle className="w-4 h-4 text-teal-600" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('dailySummary')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('dailySummaryDesc')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div id={dailySummarySwitchId} className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('dailySummaryToggle')}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('dailySummaryDesc')}</p>
                </div>
                <SettingsSwitch
                  checked={dailySummaryEnabled}
                  onCheckedChange={handleDailySummaryToggle}
                  aria-labelledby={dailySummarySwitchId}
                />
              </div>
            </div>
          </div>

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
            <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
              <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                <Calendar className="w-4 h-4 text-teal-600" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{t('summerMode')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('summerModeDesc')}</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div id={summerSwitchId} className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('summerModeToggle')}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('summerModeDesc')}</p>
                </div>
                <SettingsSwitch
                  checked={summerModeEnabled}
                  onCheckedChange={handleSummerModeToggle}
                  aria-labelledby={summerSwitchId}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
