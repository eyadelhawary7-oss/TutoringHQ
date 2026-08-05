'use client';

/**
 * `Merged-CEO` §02 (CEO Teachers) — the design's overview strip, in the design's order:
 *
 *   KPI quad   active teachers · classes this month · billable subscriptions · teacher MRR
 *   BY PLAN    one share bar per tier, teachers per tier
 *
 * The design's "Verified" and "Paid out" tiles, its fee-revenue hero and its
 * "Top earners" list are all absent by design, not by oversight — see the
 * comment block on `getCeoTeacherOverview` for the exact missing column behind
 * each one. Nothing here writes; every figure counts rows that already exist.
 */

import { useLocale, useTranslations } from 'next-intl';
import type { CeoTeacherOverview } from '@/types/ceo';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';

const TIER_LABEL_KEY: Record<string, 'standard' | 'pro' | 'scale'> = {
  teacher_standard: 'standard',
  teacher_pro: 'pro',
  teacher_scale: 'scale',
};

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="text-[17px] font-bold text-[var(--color-text-primary)] mt-1 tabular-nums">
        {value}
      </p>
    </div>
  );
}

export default function CeoTeachersOverview({ data }: { data: CeoTeacherOverview }) {
  const locale = useLocale();
  const t = useTranslations('ceoBoard');
  const tT = useTranslations('ceoTeachers');

  const totalOnPlans = data.plans.reduce((s, p) => s + p.teachers, 0);

  return (
    <section
      id="section-teacher-overview"
      aria-labelledby="teacher-overview-heading"
      className="flex flex-col gap-3"
    >
      <h2
        id="teacher-overview-heading"
        className="text-sm font-semibold text-[var(--color-text-primary)]"
      >
        {t('teachers.title')}
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi
          label={t('teachers.activeTeachers')}
          value={formatNumber(data.active_teachers, locale)}
        />
        <Kpi
          label={t('teachers.classesThisMonth')}
          value={formatNumber(data.classes_this_month, locale)}
        />
        <Kpi
          label={t('teachers.billableSubs')}
          value={formatNumber(data.billable_subscriptions, locale)}
        />
        <Kpi label={t('segment.mrr')} value={formatCurrency(data.teacher_mrr, locale)} />
      </div>

      <p className="text-xs font-semibold tracking-[0.02em] text-[var(--color-text-tertiary)] mt-1 mx-1">
        {t('teachers.byPlan')}
      </p>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
        {data.plans.map((plan) => {
          // Share of teachers who are on some plan. With nobody subscribed the
          // bar stays empty rather than defaulting every tier to a full track.
          const share = totalOnPlans > 0 ? (plan.teachers / totalOnPlans) * 100 : 0;
          const labelKey = TIER_LABEL_KEY[plan.plan_key];
          return (
            <div key={plan.plan_key} className="py-2">
              <div className="flex justify-between text-[13px] mb-1">
                <span className="text-[var(--color-text-primary)]">
                  {t('teachers.planLine', {
                    tier: labelKey ? tT(`tiers.${labelKey}`) : plan.plan_key,
                    price: formatCurrency(plan.price_gross, locale),
                  })}
                </span>
                <span className="text-[var(--color-text-secondary)] tabular-nums">
                  {t('teachers.teacherCount', {
                    count: formatNumber(plan.teachers, locale),
                  })}
                </span>
              </div>
              <div className="h-[9px] rounded-[var(--radius-pill)] bg-[var(--color-surface-0)] overflow-hidden">
                <div
                  className="h-full rounded-[var(--radius-pill)] bg-[var(--color-accent)]"
                  style={{ inlineSize: `${share}%` }}
                  role="img"
                  aria-label={formatPercent(share, locale, { maximumFractionDigits: 0 })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
