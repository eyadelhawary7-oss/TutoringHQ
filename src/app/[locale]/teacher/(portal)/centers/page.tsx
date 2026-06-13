'use client';

import { useTranslations } from 'next-intl';
import CenterCutsSection from '../../CenterCutsSection';
import CenterEarningsSection from '../../CenterEarningsSection';
import JoinCenterCard from '../../JoinCenterCard';
import GroupProposalsSection from '../../GroupProposalsSection';
import FreeZoneBanner from '../../FreeZoneBanner';
import { useTeacherContext } from '../../useTeacherContext';

/**
 * /teacher/centers - the full "What centers owe me" view: the center-cut
 * tracker (with join-request statuses), center earnings + attendance, the
 * join-a-center card, and center group proposals. All free-zone surfaces;
 * each component self-fetches. The free-zone banner shows only to teachers
 * without private access.
 */
export default function TeacherCentersPage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx } = useTeacherContext();
  const hasPrivateAccess = ctx?.hasPrivateAccess ?? false;

  return (
    <div className="flex flex-col gap-8">
      {!hasPrivateAccess && <FreeZoneBanner />}
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('centers')}</h1>
      <CenterCutsSection />
      <CenterEarningsSection />
      <JoinCenterCard />
      <GroupProposalsSection centers={ctx?.centers ?? []} />
    </div>
  );
}
