'use client';

import { useTranslations } from 'next-intl';
import AllStudentsList from '../../AllStudentsList';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import TeacherAppBar from '../../TeacherAppBar';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';
import { resolveTeacherPrivateView } from '@/lib/teacherPrivateView';

/**
 * /teacher/students - every student across the teacher's private groups. Free-zone
 * teachers see a trial upsell; a lapsed teacher drops to the free tier and sees a
 * "resubscribe to access your saved data" message (records gated, data preserved).
 */
export default function TeacherStudentsPage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);
  const view = resolveTeacherPrivateView({ hasPrivateAccess: ctx?.hasPrivateAccess ?? false, state });

  return (
    <div>
      {/* Mobile appbar (back / title / globe). The desktop sidebar already owns
          navigation and the language switch, so above md this collapses and the
          plain heading takes over. */}
      <TeacherAppBar title={t('students')} backHref="/teacher" />

      <div className="flex flex-col gap-6">
        <h1 className="hidden text-xl font-bold text-[var(--color-text-primary)] md:block">
          {t('students')}
        </h1>

        {loading && !ctx ? (
          <div className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
        ) : view === 'records' ? (
          <AllStudentsList />
        ) : view === 'resubscribe' ? (
          <>
            <PrivateUpsellCard
              tone="resume"
              title={t('students')}
              body={t('resubscribeLockedBody')}
              ctaLabel={t('resumeCta')}
              onCta={startTrial}
            />
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
    </div>
  );
}
