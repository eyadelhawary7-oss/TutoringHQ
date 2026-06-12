'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Banknote, Lock } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { BarChartComponent } from '@/components/charts/BarChartComponent';

/**
 * Locked income preview (free zone only). Renders the same income surfaces a
 * paid teacher sees, populated with fixed sample numbers, then veils them under
 * a blur + cream overlay. Hovering "peeks" (less blur, lighter overlay) and the
 * CTA starts the trial. Nothing here is real data and no private route is hit -
 * it is a conversion surface, not the income view.
 */

const SAMPLE = {
  totalThisMonth: 14400,
  groups: [
    { key: 'group1', students: 6, amount: 8400 },
    { key: 'group2', students: 4, amount: 4800 },
  ],
  pendingKeys: ['payer1', 'payer2', 'payer3'] as const,
  weeks: [11200, 13600, 12800, 14400],
};

export default function LockedIncomePreview({ onStartTrial }: { onStartTrial: () => void }) {
  const t = useTranslations('teacherPortal.lockedIncome');
  const tIncome = useTranslations('teacherPortal.income');
  const locale = useLocale();

  const chartData = SAMPLE.weeks.map((amount, i) => ({
    week: t('weekLabel', { n: formatNumber(i + 1, locale) }),
    amount,
  }));

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
        <Banknote size={18} className="text-[var(--color-brass)]" aria-hidden />
        {t('heading')}
      </h2>

      <div className="group relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]">
        {/* Sample dashboard, veiled. Inert: clicks fall through to the overlay. */}
        <div
          aria-hidden
          className="pointer-events-none select-none p-5 blur-[4px] transition-all duration-300 group-hover:blur-[2px]"
        >
          <div className="money-hero mb-5 rounded-[var(--radius-card)] p-5">
            <div className="mb-1 flex items-center gap-2 text-sm text-[#dfeeeb]">
              <Banknote size={16} aria-hidden />
              {tIncome('collectedThisMonth')}
            </div>
            <p className="num text-3xl font-bold">
              {formatCurrency(SAMPLE.totalThisMonth, locale)}
            </p>
          </div>

          <div className="mb-5 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <p className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('weeklyTrend')}
            </p>
            <BarChartComponent
              data={chartData}
              dataKey="amount"
              xKey="week"
              color="teal"
              height={150}
              currencyYAxis={{ locale }}
            />
          </div>

          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
            {tIncome('byGroup')}
          </h3>
          <ul className="mb-5 flex flex-col gap-2">
            {SAMPLE.groups.map((g) => (
              <li
                key={g.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-[var(--color-text-primary)]">
                    {t(g.key)}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {t('studentsCount', { count: formatNumber(g.students, locale) })}
                  </span>
                </span>
                <span className="num text-sm font-semibold text-[var(--color-text-primary)]">
                  {formatCurrency(g.amount, locale)}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
            {t('pendingTitle')}
          </h3>
          <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {SAMPLE.pendingKeys.map((k) => (
              <li
                key={k}
                className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
              >
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{t(k)}</span>
                <span className="rounded-full bg-[var(--color-brass-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-brass)]">
                  {t('pendingBadge')}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Cream veil + lock CTA. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[rgba(236,232,223,0.75)] p-6 text-center transition-colors duration-300 group-hover:bg-[rgba(236,232,223,0.6)]">
          <Lock size={36} className="text-[var(--color-brass)]" aria-hidden />
          <p className="max-w-sm text-base font-semibold text-[var(--color-text-primary)]">
            {t('overlayText')}
          </p>
          <button
            type="button"
            onClick={onStartTrial}
            className="rounded-[18px] bg-[var(--color-brass)] px-5 py-3 font-semibold text-white shadow-card transition-opacity hover:opacity-90"
          >
            {t('overlayCta')}
          </button>
        </div>
      </div>
    </section>
  );
}
