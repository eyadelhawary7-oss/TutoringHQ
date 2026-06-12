'use client';

import { useTranslations } from 'next-intl';
import IncomeView from '../../IncomeView';
import LockedIncomePreview from '../../LockedIncomePreview';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';

/**
 * /teacher/income - private income analytics. Free-zone teachers see the
 * blurred locked preview with a trial CTA; the URL stays bookmarkable.
 */
export default function TeacherIncomePage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('income')}</h1>

      {loading && !ctx ? (
        <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : ctx?.hasPrivateAccess ? (
        <IncomeView />
      ) : (
        <>
          <LockedIncomePreview onStartTrial={startTrial} />
          {modal}
        </>
      )}
    </div>
  );
}
