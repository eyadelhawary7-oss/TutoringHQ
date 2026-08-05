'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import CenterCutsSection from '../../CenterCutsSection';
import CenterEarningsSection from '../../CenterEarningsSection';
import JoinCenterCard from '../../JoinCenterCard';
import MyCodeCard from '../../MyCodeCard';
import GroupProposalsSection from '../../GroupProposalsSection';
import GroupSlotsSection from '../../GroupSlotsSection';
import BringGroupToCenterSection from '../../BringGroupToCenterSection';
import FreeZoneBanner from '../../FreeZoneBanner';
import { useTeacherContext } from '../../useTeacherContext';

/**
 * /teacher/centers - the full "What centers owe me" view: the center-cut
 * tracker (with join-request statuses), center earnings + attendance, the
 * join-a-center card, and center group proposals. All free-zone surfaces;
 * each component self-fetches. The free-zone banner shows only to teachers
 * without private access.
 *
 * ORDER IS `Merged-Teacher-Setup` §02's ORDER, not the order these components
 * happened to be written in. The design reads: owed hero -> Your centers ->
 * Group proposals -> Class times -> Join a center. The live-only extras keep
 * the neighbour they belong to - the attendance list sits with the centers it
 * itemises, and "bring a group to a center" sits with the proposals it creates.
 *
 * The all-time figure is fetched ONCE, by CenterEarningsSection, and handed to
 * the hero so §02's two-stat footer is drawn without a second query or a second
 * definition of the same number. Until it arrives the hero omits that stat
 * rather than showing a zero (see the note in CenterCutsSection).
 */
export default function TeacherCentersPage() {
  const t = useTranslations('teacherPortal.pages');
  const { ctx } = useTeacherContext();
  const hasPrivateAccess = ctx?.hasPrivateAccess ?? false;
  // Bumped when a group is brought to a center, so the proposals list refetches.
  const [proposalsRefresh, setProposalsRefresh] = useState(0);
  const [allTimeEarned, setAllTimeEarned] = useState<number | null>(null);

  const handleTotals = useCallback(
    ({ earnedAllTime }: { earnedThisMonth: number; earnedAllTime: number }) => {
      setAllTimeEarned(earnedAllTime);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      {!hasPrivateAccess && <FreeZoneBanner />}
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('centers')}</h1>

      {/* Hero + Your centers */}
      <CenterCutsSection canDetach={hasPrivateAccess} allTimeEarned={allTimeEarned} />
      <CenterEarningsSection showTotals={false} onTotals={handleTotals} />

      {/* Group proposals */}
      {hasPrivateAccess && (
        <BringGroupToCenterSection
          centers={ctx?.centers ?? []}
          onCreated={() => setProposalsRefresh((n) => n + 1)}
        />
      )}
      <GroupProposalsSection centers={ctx?.centers ?? []} refreshKey={proposalsRefresh} />

      {/* Class times */}
      <GroupSlotsSection refreshKey={proposalsRefresh} />

      {/* Join a center */}
      <JoinCenterCard />
      <MyCodeCard compact />
    </div>
  );
}
