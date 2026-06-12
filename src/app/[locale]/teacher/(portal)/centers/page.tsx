'use client';

import { useTranslations } from 'next-intl';
import CenterCutsSection from '../../CenterCutsSection';
import JoinCenterCard from '../../JoinCenterCard';
import GroupProposalsSection from '../../GroupProposalsSection';
import { useTeacherContext } from '../../useTeacherContext';

/**
 * /teacher/centers - the full "What centers owe me" view: the center-cut
 * tracker (with join-request statuses), the join-a-center card, and center
 * group proposals. All free-zone surfaces; each component self-fetches.
 */
export default function TeacherCentersPage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx } = useTeacherContext();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('centers')}</h1>
      <CenterCutsSection />
      <JoinCenterCard />
      <GroupProposalsSection centers={ctx?.centers ?? []} />
    </div>
  );
}
