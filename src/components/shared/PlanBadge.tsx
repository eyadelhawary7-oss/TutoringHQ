'use client';

import { useTranslations } from 'next-intl';

const styles: Record<string, string> = {
  solo: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] border border-slate-300',
  nano: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] border border-slate-300',
  starter: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)] border border-slate-300',
  pro: 'bg-blue-100 text-blue-700 border border-blue-300',
  business: 'bg-teal-100 text-teal-700 border border-teal-300',
  enterprise: 'bg-purple-100 text-purple-700 border border-purple-300',
  top_centers: 'bg-amber-100 text-amber-700 border border-amber-300',
  payg: 'bg-indigo-100 text-indigo-700 border border-indigo-300',
};

const PLAN_LABEL_KEYS = [
  'solo',
  'nano',
  'starter',
  'pro',
  'business',
  'enterprise',
  'top_centers',
  'payg',
] as const;

function canonicalPlanKey(plan?: string): string {
  const raw = plan?.toLowerCase() ?? 'starter';
  return raw;
}

export default function PlanBadge({ plan }: { plan?: string }) {
  const t = useTranslations('billing');
  const key = canonicalPlanKey(plan);
  const labelKey = PLAN_LABEL_KEYS.includes(key as (typeof PLAN_LABEL_KEYS)[number])
    ? key
    : null;
  const text = labelKey
    ? t(`planNames.${labelKey}`)
    : (plan ?? t('planNames.nano'));

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[key] ?? styles.starter}`}
    >
      {text}
    </span>
  );
}
