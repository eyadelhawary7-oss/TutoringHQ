'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatNumber';
import UpgradeFlow from './UpgradeFlow';

/**
 * Side-by-side Standard vs Pro comparison. Shared by the billing upgrade
 * section and the teacher pricing page. The Pro card carries the upgrade CTA
 * when the viewer is Standard; when payments are off it shows a visible
 * "unavailable" banner instead of a dead button.
 */
export default function PlanComparison({
  currentPlanKey,
  stdPrice,
  proPrice,
  paymentsEnabled,
}: {
  currentPlanKey: string;
  stdPrice: number;
  proPrice: number;
  paymentsEnabled: boolean;
}) {
  const t = useTranslations('teacherBilling');
  const locale = useLocale();
  const isStandard = currentPlanKey === 'teacher_299';
  const isPro = currentPlanKey === 'teacher_699';

  const stdFeatures = (t.raw('standardFeatures') as string[]) ?? [];
  const proFeatures = (t.raw('proFeatures') as string[]) ?? [];

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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Standard */}
      <div className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('planStandard')}</h3>
          {isStandard && (
            <span className="rounded-full bg-[var(--color-teal-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-teal-deep)]">
              {t('currentPlanBadge')}
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(stdPrice, locale)}
          </span>{' '}
          {t('perMonth')}
        </p>
        <ul className="flex flex-col gap-2">{stdFeatures.map((f) => featureRow(f, 'teal'))}</ul>
      </div>

      {/* Pro */}
      <div className="flex flex-col rounded-xl border-2 border-[var(--color-brass)]/50 bg-[var(--color-brass-soft)] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('planPro')}</h3>
          <span className="rounded-full bg-[var(--color-brass)] px-2.5 py-0.5 text-xs font-medium text-white">
            {isPro ? t('currentPlanBadge') : t('mostComprehensiveBadge')}
          </span>
        </div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          <span className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(proPrice, locale)}
          </span>{' '}
          {t('perMonth')}
        </p>
        <ul className="mb-5 flex flex-col gap-2">{proFeatures.map((f) => featureRow(f, 'brass'))}</ul>

        <div className="mt-auto">
          {isPro ? (
            <p className="text-sm font-medium text-[var(--color-brass)]">{t('currentPlanStatic')}</p>
          ) : paymentsEnabled ? (
            <UpgradeFlow label={t('upgradeCta')} variant="brass" />
          ) : (
            <p className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] px-3 py-2 text-sm font-medium text-[var(--color-warning)]">
              {t('paymentsUnavailable')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
