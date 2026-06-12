'use client';

import { useTranslations } from 'next-intl';
import AllStudentsList from '../../AllStudentsList';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';

/**
 * /teacher/students - every student across the teacher's private groups.
 * Free-zone teachers see a locked upsell.
 */
export default function TeacherStudentsPage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('students')}</h1>

      {loading && !ctx ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : ctx?.hasPrivateAccess ? (
        <AllStudentsList />
      ) : (
        <>
          <PrivateUpsellCard
            tone={state === 'lapsed' ? 'resume' : 'trial'}
            title={t('students')}
            body={t('studentsLockedBody')}
            ctaLabel={state === 'lapsed' ? t('resumeCta') : t('startTrialCta')}
            onCta={startTrial}
          />
          {modal}
        </>
      )}
    </div>
  );
}
