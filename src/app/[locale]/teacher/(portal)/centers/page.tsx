'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CenterCutsSection from '../../CenterCutsSection';
import CenterEarningsSection from '../../CenterEarningsSection';
import JoinCenterCard from '../../JoinCenterCard';
import MyCodeCard from '../../MyCodeCard';
import GroupProposalsSection from '../../GroupProposalsSection';
import BringGroupToCenterSection from '../../BringGroupToCenterSection';
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
  // Bumped when a group is brought to a center, so the proposals list refetches.
  const [proposalsRefresh, setProposalsRefresh] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      {!hasPrivateAccess && <FreeZoneBanner />}
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('centers')}</h1>
      <CenterCutsSection canDetach={hasPrivateAccess} />
      <CenterEarningsSection />
      <JoinCenterCard />
      <MyCodeCard compact />
      {hasPrivateAccess && (
        <BringGroupToCenterSection
          centers={ctx?.centers ?? []}
          onCreated={() => setProposalsRefresh((n) => n + 1)}
        />
      )}
      <GroupProposalsSection centers={ctx?.centers ?? []} refreshKey={proposalsRefresh} />
    </div>
  );
}
