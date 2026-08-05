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
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsGroupLabel,
} from '@/components/settings/SettingsRows';

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

        {/* §05 Notifications, drawn as the design's labelled group of toggle
            rows rather than two full-width cards.

            The design's six "NOTIFY ME ABOUT" rows (payments recorded,
            absences, new students, card orders, teacher payout requests,
            billing & add-ons), the HOW group (push / email) and QUIET HOURS are
            NOT drawn, and were not skipped for effort: D9 (decided 28 July, do
            not build) — there is no owner-level notification-preference model
            anywhere. Re-checked live this pass: the only `notify_*` columns in
            `public` are `students.notify_on_absence` / `notify_on_balance` /
            `notify_on_scan`, which are per-STUDENT parent toggles, a different
            feature. `centers` carries no quiet-hours, push or email column.

            The two rows below are the real centre-wide toggles this screen has
            always written: `centers.daily_summary_enabled` and
            `centers.summer_mode`. Both confirmed present in
            information_schema.columns. */}
        <div className="space-y-5">
          <div>
            <SettingsGroupLabel>{t('sectionNotifications')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsControlRow
                icon={MessageCircle}
                label={t('dailySummary')}
                description={t('dailySummaryDesc')}
                labelId={dailySummarySwitchId}
              >
                <SettingsSwitch
                  checked={dailySummaryEnabled}
                  onCheckedChange={handleDailySummaryToggle}
                  aria-labelledby={dailySummarySwitchId}
                />
              </SettingsControlRow>
              <SettingsControlRow
                icon={Calendar}
                iconClassName="bg-[var(--color-sand)] text-[var(--color-brass)]"
                label={t('summerMode')}
                description={t('summerModeDesc')}
                labelId={summerSwitchId}
              >
                <SettingsSwitch
                  checked={summerModeEnabled}
                  onCheckedChange={handleSummerModeToggle}
                  aria-labelledby={summerSwitchId}
                />
              </SettingsControlRow>
            </SettingsGroup>
          </div>
        </div>
      </div>
    </div>
  );
}
