'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PrivateGroupsSection from '../../PrivateGroupsSection';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import PrivateLockSummary from '../../PrivateLockSummary';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';
import { resolveTeacherPrivateView } from '@/lib/teacherPrivateView';

/**
 * /teacher/groups - the teacher's private group list. Free-zone teachers see a
 * locked upsell; a lapsed teacher sees the lock summary (headline numbers + pay);
 * the URL still resolves here so it is bookmarkable.
 */
export default function TeacherGroupsPage() {
  const t = useTranslations('teacherPortal.pages');
  const tp = useTranslations('teacherPortal');
  const { ctx, loading, reload } = useTeacherContext();
  const [refreshKey, setRefreshKey] = useState(0);

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, () => {
    reload();
    setRefreshKey((k) => k + 1);
  });
  const view = resolveTeacherPrivateView({ hasPrivateAccess: ctx?.hasPrivateAccess ?? false, state });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('groups')}</h1>

      {loading && !ctx ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : view === 'records' ? (
        <PrivateGroupsSection refreshKey={refreshKey} onAdd={startTrial} />
      ) : view === 'lock_summary' ? (
        <PrivateLockSummary title={tp('lockSummary.title')} payLabel={t('resumeCta')} onPay={startTrial} />
      ) : (
        <PrivateUpsellCard
          tone="trial"
          title={t('groups')}
          body={t('groupsLockedBody')}
          ctaLabel={t('startTrialCta')}
          onCta={startTrial}
        />
      )}

      {modal}
    </div>
  );
}
