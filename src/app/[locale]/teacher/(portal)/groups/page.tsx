'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PrivateGroupsSection from '../../PrivateGroupsSection';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';

/**
 * /teacher/groups - the teacher's private group list. Free-zone teachers see a
 * locked upsell; the URL still resolves here so it is bookmarkable.
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('groups')}</h1>

      {loading && !ctx ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : ctx?.hasPrivateAccess ? (
        <PrivateGroupsSection refreshKey={refreshKey} onAdd={startTrial} />
      ) : (
        <PrivateUpsellCard
          tone={state === 'lapsed' ? 'resume' : 'trial'}
          title={t('groups')}
          body={t('groupsLockedBody')}
          ctaLabel={state === 'lapsed' ? t('resumeCta') : t('startTrialCta')}
          onCta={startTrial}
        />
      )}

      {modal}
    </div>
  );
}
