'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatNumber';
import { getTeacherPlan, TEACHER_PLANS } from '@/lib/teacherPlans';
import UpgradeFlow from './UpgradeFlow';

/**
 * Standard / Pro / Scale comparison. Shared by the billing upgrade section and
 * the teacher pricing page. Each tier above the viewer's current tier carries
 * the upgrade CTA; the viewer's current tier is badged. When payments are off
 * the CTA is replaced by a visible "unavailable" banner. Pro is the only tier
 * with a label ("Best for Part-Time").
 */
export default function PlanComparison({
  currentPlanKey,
  stdPrice,
  proPrice,
  scalePrice = TEACHER_PLANS.teacher_scale.priceGross,
  paymentsEnabled,
}: {
  currentPlanKey: string;
  stdPrice: number;
  proPrice: number;
  scalePrice?: number;
  paymentsEnabled: boolean;
}) {
  const t = useTranslations('teacherBilling');
  const locale = useLocale();
  const currentRank = getTeacherPlan(currentPlanKey).rank;

  const stdFeatures = (t.raw('standardFeatures') as string[]) ?? [];
  const proFeatures = (t.raw('proFeatures') as string[]) ?? [];
  const scaleFeatures = (t.raw('scaleFeatures') as string[]) ?? [];

  const featureRow = (text: string, tone: 'teal' | 'brass') => (
    <li key={text} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
      <Check
        size={16}
        className={tone === 'brass' ? 'mt-0.5 shrink-0 text-[var(--color-brass)]' : 'mt-0.5 shrink-0 text-[var(--color-teal-deep)]'}
        aria-hidden
      />
      <span>{text}</span>
    </li>
  );

  // CTA shown on a tier: current → static "your current plan"; above current →
  // UpgradeFlow (or unavailable banner); below current → nothing.
  const cta = (rank: number) => {
    if (rank === currentRank) {
      return <p className="text-sm font-medium text-[var(--color-brass)]">{t('currentPlanStatic')}</p>;
    }
    if (rank < currentRank) return null;
    if (!paymentsEnabled) {
      return (
        <p className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-3 py-2 text-sm font-medium text-[var(--color-warning)]">
          {t('paymentsUnavailable')}
        </p>
      );
    }
    return <UpgradeFlow label={t('upgradeCtaGeneric')} variant="brass" />;
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Standard */}
      <div className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('planStandard')}</h3>
          {currentRank === 1 && (
            <span className="rounded-full bg-[var(--color-teal-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-teal-deep)]">
              {t('currentPlanBadge')}
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(stdPrice, locale)}
          </span>{' '}
          {t('perMonth')}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('stdCapLine')}</p>
        <p className="mb-4 mt-0.5 text-xs font-medium text-[var(--color-brass)]">{t('stdPerStudent')}</p>
        <ul className="mb-5 flex flex-col gap-2">{stdFeatures.map((f) => featureRow(f, 'teal'))}</ul>
        <div className="mt-auto">{cta(1)}</div>
      </div>

      {/* Pro */}
      <div className="flex flex-col rounded-xl border-2 border-[var(--color-brass)]/50 bg-[var(--color-brass-soft)] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('planPro')}</h3>
          <span className="rounded-full bg-[var(--color-brass)] px-2.5 py-0.5 text-xs font-medium text-white">
            {currentRank === 2 ? t('currentPlanBadge') : t('bestForPartTimeBadge')}
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(proPrice, locale)}
          </span>{' '}
          {t('perMonth')}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('proCapLine')}</p>
        <p className="mb-4 mt-0.5 text-xs font-medium text-[var(--color-brass)]">{t('proPerStudent')}</p>
        <ul className="mb-5 flex flex-col gap-2">{proFeatures.map((f) => featureRow(f, 'brass'))}</ul>
        <div className="mt-auto">{cta(2)}</div>
      </div>

      {/* Scale */}
      <div className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('planScale')}</h3>
          {currentRank === 3 && (
            <span className="rounded-full bg-[var(--color-brass)] px-2.5 py-0.5 text-xs font-medium text-white">
              {t('currentPlanBadge')}
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(scalePrice, locale)}
          </span>{' '}
          {t('perMonth')}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('scaleCapLine')}</p>
        <p className="mb-4 mt-0.5 text-xs font-medium text-[var(--color-brass)]">{t('scalePerStudent')}</p>
        <ul className="mb-5 flex flex-col gap-2">{scaleFeatures.map((f) => featureRow(f, 'brass'))}</ul>
        <div className="mt-auto">{cta(3)}</div>
      </div>
    </div>
  );
}
