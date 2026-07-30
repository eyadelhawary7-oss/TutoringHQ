'use client';

import { useTranslations, useLocale } from 'next-intl';
import { formatPercent } from '@/lib/formatNumber';
import { Link } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top Centers',
};

interface PlanUsageCardProps {
  plan: string;
  weeklyUniqueStudents: number;
  studentLimit: number;
}

export default function PlanUsageCard({ plan, weeklyUniqueStudents, studentLimit }: PlanUsageCardProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { user } = useUser();
  const isOwner = user?.role === 'owner' || user?.role === 'super_admin';

  if (studentLimit >= 999999) return null; // Unlimited plan

  const pct = studentLimit > 0 ? Math.round((weeklyUniqueStudents / studentLimit) * 100) : 0;
  const isGreen = pct <= 70;
  const isYellow = pct > 70 && pct <= 90;
  const isRed = pct > 90;

  // isRed -> danger, isYellow -> brass (KpiCard's TONE_CLASS convention: warning
  // and danger sit on §4's brass/danger slots; success has no §4 slot yet, see
  // KpiCard.tsx, so the "on track" bar keeps --color-success).
  const barColorVar = isRed ? '--color-danger' : isYellow ? '--color-brass' : '--color-success';

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {t('planUsage', { defaultValue: 'Plan Usage' })}
        </h2>
        <span className="text-sm text-[var(--color-text-secondary)]">
          {PLAN_LABELS[plan] || plan}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] mb-2">
        {t('studentsThisWeek', {
          current: weeklyUniqueStudents,
          max: studentLimit,
          pct: formatPercent(pct, locale),
        })}
      </p>
      <div className="h-3 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: `var(${barColorVar})` }}
        />
      </div>
      {isYellow && isOwner && (
        <p className="text-sm text-[var(--color-brass)] mt-2">
          {t('approachingLimit', { defaultValue: 'Approaching limit' })}
        </p>
      )}
      {isRed && isOwner && (
        <p className="text-sm text-[var(--color-danger)] mt-2">
          {t('upgradeRecommended', { defaultValue: 'Upgrade recommended' })}
        </p>
      )}
      {(isYellow || isRed) && isOwner && (
        <Link
          href="/settings/billing"
          className="inline-block mt-3 px-4 py-2 text-sm font-medium bg-[var(--color-accent)] hover:opacity-90 text-white rounded-lg transition-opacity"
        >
          {t('upgradePlan', { defaultValue: 'Upgrade Plan' })}
        </Link>
      )}
    </div>
  );
}
