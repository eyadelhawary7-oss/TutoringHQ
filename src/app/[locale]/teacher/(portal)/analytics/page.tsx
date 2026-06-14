'use client';

import { useTranslations } from 'next-intl';
import AnalyticsView from '../../AnalyticsView';
import LockedAnalyticsPreview from '../../LockedAnalyticsPreview';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';

/**
 * /teacher/analytics — Pro teacher analytics. Free-zone teachers see the blurred
 * locked preview with a trial CTA; teachers with private access see AnalyticsView
 * (which itself drops Standard teachers to the brass upgrade row via the Pro
 * gate). The URL stays bookmarkable in every state.
 */
export default function TeacherAnalyticsPage() {
  const t = useTranslations('teacherPortal.pages');
  const tAnalytics = useTranslations('teacherPortal.analytics');
  const { ctx, loading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('analytics')}</h1>
        {ctx?.hasPrivateAccess && (
          <p className="text-sm text-[var(--color-text-secondary)]">{tAnalytics('pageSubtitle')}</p>
        )}
      </div>

      {loading && !ctx ? (
        <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      ) : ctx?.hasPrivateAccess ? (
        <AnalyticsView />
      ) : (
        <>
          <LockedAnalyticsPreview onStartTrial={startTrial} />
          {modal}
        </>
      )}
    </div>
  );
}
