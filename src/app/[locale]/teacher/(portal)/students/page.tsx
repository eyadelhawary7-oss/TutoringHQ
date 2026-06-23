'use client';

import { useTranslations } from 'next-intl';
import AllStudentsList from '../../AllStudentsList';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import PrivateLockSummary from '../../PrivateLockSummary';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';
import { resolveTeacherPrivateView } from '@/lib/teacherPrivateView';

/**
 * /teacher/students - every student across the teacher's private groups.
 * Free-zone teachers see a locked upsell; a lapsed teacher sees the lock summary.
 */
export default function TeacherStudentsPage() {
  const t = useTranslations('teacherPortal.pages');
  const tp = useTranslations('teacherPortal');
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);
  const view = resolveTeacherPrivateView({ hasPrivateAccess: ctx?.hasPrivateAccess ?? false, state });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('students')}</h1>

      {loading && !ctx ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : view === 'records' ? (
        <AllStudentsList />
      ) : view === 'lock_summary' ? (
        <>
          <PrivateLockSummary title={tp('lockSummary.title')} payLabel={t('resumeCta')} onPay={startTrial} />
          {modal}
        </>
      ) : (
        <>
          <PrivateUpsellCard
            tone="trial"
            title={t('students')}
            body={t('studentsLockedBody')}
            ctaLabel={t('startTrialCta')}
            onCta={startTrial}
          />
          {modal}
        </>
      )}
    </div>
  );
}
