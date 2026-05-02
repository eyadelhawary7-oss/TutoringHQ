'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top Centers',
  payg: 'Pay-As-You-Go',
};

interface PlanUsageCardProps {
  plan: string;
  weeklyUniqueStudents: number;
  studentLimit: number;
}

export default function PlanUsageCard({ plan, weeklyUniqueStudents, studentLimit }: PlanUsageCardProps) {
  const t = useTranslations('dashboard');
  const tSettings = useTranslations('settings');
  const { user } = useUser();
  const isOwner = user?.role === 'owner' || user?.role === 'super_admin';

  if (studentLimit >= 999999) return null; // Unlimited plan

  const pct = studentLimit > 0 ? Math.round((weeklyUniqueStudents / studentLimit) * 100) : 0;
  const isGreen = pct <= 70;
  const isYellow = pct > 70 && pct <= 90;
  const isRed = pct > 90;

  const barColor = isRed ? 'bg-red-500' : isYellow ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="glass p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('planUsage', { defaultValue: 'Plan Usage' })}
        </h2>
        <span className="text-sm text-[var(--text-secondary)]">
          {PLAN_LABELS[plan] || plan}
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)] mb-2">
        {t('studentsThisWeek', {
          current: weeklyUniqueStudents,
          max: studentLimit,
          pct: String(pct),
        })}
      </p>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {isYellow && isOwner && (
        <p className="text-sm text-amber-500 mt-2">
          {t('approachingLimit', { defaultValue: 'Approaching limit' })}
        </p>
      )}
      {isRed && isOwner && (
        <p className="text-sm text-red-500 mt-2">
          {t('upgradeRecommended', { defaultValue: 'Upgrade recommended' })}
        </p>
      )}
      {(isYellow || isRed) && isOwner && (
        <Link
          href="/settings/billing"
          className="inline-block mt-3 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
        >
          {t('upgradePlan', { defaultValue: 'Upgrade Plan' })}
        </Link>
      )}
    </div>
  );
}
