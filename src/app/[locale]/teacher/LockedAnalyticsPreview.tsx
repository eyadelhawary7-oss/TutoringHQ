'use client';

import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, CalendarClock, Lock } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { BarChartComponent } from '@/components/charts/BarChartComponent';

/**
 * Locked analytics preview (free zone only). Renders the same analytics surfaces
 * a Pro teacher sees, populated with fixed sample numbers, then veils them under
 * a blur + cream overlay with a trial CTA. Nothing here is real data and no
 * private route is hit — it is a conversion surface, mirroring
 * LockedIncomePreview.
 */

const SAMPLE = {
  projectionTotal: 38400,
  groups: [
    { key: 'group1', value: 22800 },
    { key: 'group2', value: 15600 },
  ],
  attendance: [
    { dow: 0, value: 9 },
    { dow: 1, value: 7 },
    { dow: 2, value: 8 },
    { dow: 3, value: 6 },
  ],
};

export default function LockedAnalyticsPreview({ onStartTrial }: { onStartTrial: () => void }) {
  const t = useTranslations('teacherPortal.lockedAnalytics');
  const locale = useLocale();

  const chartData = SAMPLE.attendance.map((d) => ({
    day: formatNumber(d.dow + 1, locale),
    attendance: d.value,
  }));

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
        <BarChart3 size={18} className="text-[var(--color-brass)]" aria-hidden />
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
              <CalendarClock size={16} aria-hidden />
              {t('projectionTitle')}
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {t('estimateBadge')}
              </span>
            </div>
            <p className="num text-3xl font-bold">{formatCurrency(SAMPLE.projectionTotal, locale)}</p>
          </div>

          <ul className="mb-5 flex flex-col gap-2">
            {SAMPLE.groups.map((g) => (
              <li
                key={g.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <span className="font-medium text-[var(--color-text-primary)]">{t(g.key)}</span>
                <span className="num text-sm font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(g.value, locale)}
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <p className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">
              {t('attendanceTitle')}
            </p>
            <BarChartComponent
              data={chartData}
              dataKey="attendance"
              xKey="day"
              color="teal"
              height={150}
              integerYAxis
            />
          </div>
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
