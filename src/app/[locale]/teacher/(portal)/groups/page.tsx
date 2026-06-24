'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PrivateGroupsSection from '../../PrivateGroupsSection';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';
import { resolveTeacherPrivateView } from '@/lib/teacherPrivateView';

/**
 * /teacher/groups - the teacher's private group list. Free-zone teachers see a
 * trial upsell; a lapsed teacher drops to the free tier and sees a "resubscribe
 * to access your saved data" message (records gated, data preserved). The URL
 * still resolves here so it is bookmarkable.
 */
export default function TeacherGroupsPage() {
  const t = useTranslations('teacherPortal.pages');
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
      ) : view === 'resubscribe' ? (
        <PrivateUpsellCard
          tone="resume"
          title={t('groups')}
          body={t('resubscribeLockedBody')}
          ctaLabel={t('resumeCta')}
          onCta={startTrial}
        />
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
