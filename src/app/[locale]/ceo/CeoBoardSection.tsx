'use client';

/**
 * `Merged-CEO` §01 (CEO Dashboard) — the design's board view, in the design's order:
 *
 *   1. hero        total revenue this Cairo month + MoM trend
 *   2. chart       revenue, last six Cairo months
 *   3. KPI quad    MRR · active accounts · net new
 *   4. segment     centers — accounts, MRR, growth
 *   5. segment     teachers — accounts, MRR
 *   6. KPI pair    churn · ARPU
 *
 * OMITTED, and why — the design draws two more figures this cannot honestly show:
 *
 *   "Fee revenue" (the §01 KPI quad's second tile, and the teachers segment's
 *   third row). The platform's fee on teacher-run classes lives in
 *   `transactions.teacher_net` / `teacher_commission_amt`, which no write path
 *   ever populates — `compute_lesson_money` has zero call sites and
 *   `finish_center_class_and_bill` is unreachable. Every value would read
 *   EGP 0 for every teacher, always. That is D19 (private lessons) and D16
 *   (center classes), both open. Rendering a 0 here would ship exactly the
 *   live-wrong-number those entries exist to prevent.
 *
 * Nothing on this screen writes. Every figure is a count or a sum of rows that
 * already exist; the arithmetic is in `src/lib/ceoBoard.ts` with its sources.
 */

import { useLocale, useTranslations } from 'next-intl';
import type { CeoBoardData } from '@/types/ceo';
import {
  formatCurrency,
  formatDate,
  formatGrowth,
  formatNumber,
  formatPercent,
} from '@/lib/formatNumber';

/** Mid-month instant for a `YYYY-MM` key — safe to format in any timezone. */
function monthLabelDate(monthKey: string): Date | null {
  const [y, m] = monthKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(Date.UTC(y, m - 1, 15));
}

const CARD =
  'rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4';

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.02em] text-[var(--color-text-tertiary)] mt-1 mb-[-2px] mx-1">
      {children}
    </p>
  );
}

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

function SegRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px] py-2 border-t border-[var(--color-border-subtle)] first-of-type:border-t-0">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

export default function CeoBoardSection({ board }: { board: CeoBoardData }) {
  const locale = useLocale();
  const t = useTranslations('ceoBoard');

  const trend = formatGrowth(board.revenue_this_month, board.revenue_prior_month, locale);
  const peak = Math.max(...board.revenue_series.map((p) => p.revenue), 0);
  const centerGrowth =
    board.center.mrr_at_month_start != null
      ? formatGrowth(board.center.mrr, board.center.mrr_at_month_start, locale)
      : null;

  return (
    <section id="section-board" aria-labelledby="board-heading" className="flex flex-col gap-3">
      <h2 id="board-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">
        {t('title')}
      </h2>

      {/* 1 · Hero — total revenue this Cairo month */}
      <div
        className="rounded-[var(--radius-lg)] p-6 text-[var(--color-paper)]"
        style={{
          background:
            'linear-gradient(155deg, var(--color-accent), var(--color-accent-deep))',
        }}
      >
        <p className="text-xs opacity-85">{t('hero.totalRevenue')}</p>
        <p className="text-3xl font-bold mt-1 tabular-nums">
          {formatCurrency(board.revenue_this_month, locale)}
        </p>
        {trend && (
          <span className="inline-flex items-center gap-1 text-[11px] bg-white/15 px-3 py-1 rounded-[var(--radius-pill)] mt-2">
            {t('hero.vsLastMonth', { pct: trend })}
          </span>
        )}
      </div>

      {/* 2 · Revenue, last six Cairo months */}
      <div className={CARD}>
        <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">
          {t('chart.title', { count: formatNumber(board.revenue_series.length, locale) })}
        </p>
        <div className="flex items-end gap-2 h-[104px]">
          {board.revenue_series.map((point, i) => {
            const isCurrent = i === board.revenue_series.length - 1;
            // A zero month must still read as zero, not as a missing bar.
            const pct = peak > 0 ? Math.max((point.revenue / peak) * 100, 1.5) : 1.5;
            return (
              <div
                key={point.month}
                className={`flex-1 rounded-t-[var(--radius-xs)] ${
                  isCurrent ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-mint)]'
                }`}
                style={{ height: `${pct}%` }}
                title={`${point.month} · ${formatCurrency(point.revenue, locale)}`}
              />
            );
          })}
        </div>
        <div className="flex gap-2 mt-1">
          {board.revenue_series.map((point) => {
            const d = monthLabelDate(point.month);
            return (
              <span
                key={point.month}
                className="flex-1 text-center text-[11px] text-[var(--color-text-tertiary)]"
              >
                {d ? formatDate(d, locale, { month: 'short' }) : point.month}
              </span>
            );
          })}
        </div>
      </div>

      {/* 3 · KPI quad, minus the blocked "Fee revenue" tile (see header) */}
      <div className="grid grid-cols-2 gap-2">
        <Kpi label={t('kpi.mrr')} value={formatCurrency(board.mrr_total, locale)} />
        <Kpi
          label={t('kpi.activeAccounts')}
          value={formatNumber(board.active_accounts, locale)}
        />
        <Kpi label={t('kpi.newAccounts')} value={formatNumber(board.new_accounts, locale)} />
        <Kpi
          label={t('kpi.netNewCenters')}
          value={formatNumber(board.net_new_centers, locale)}
        />
      </div>

      <GroupLabel>{t('bySegment')}</GroupLabel>

      {/* 4 · Centers segment */}
      <div className={CARD}>
        <div className="flex items-center gap-2 mb-3">
          <span className="size-[34px] shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-mint)] text-[var(--color-accent-deep)] flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 21h18M6 21V7l6-4 6 4v14M10 21v-4h4v4" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            {t('segment.centers')}
          </p>
        </div>
        <SegRow label={t('segment.accounts')} value={formatNumber(board.center.accounts, locale)} />
        <SegRow label={t('segment.mrr')} value={formatCurrency(board.center.mrr, locale)} />
        <SegRow
          label={t('segment.revenueThisMonth')}
          value={formatCurrency(board.center.revenue_this_month, locale)}
        />
        {/* Growth needs a month-start snapshot to compare against; without one
            there is no baseline, so the row is dropped rather than shown as 0%. */}
        {centerGrowth && <SegRow label={t('segment.growth')} value={centerGrowth} />}
      </div>

      {/* 5 · Teachers segment — "Fee revenue" row omitted, see header */}
      <div className={CARD}>
        <div className="flex items-center gap-2 mb-3">
          <span className="size-[34px] shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-sand)] text-[var(--color-brass)] flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            {t('segment.teachers')}
          </p>
        </div>
        <SegRow
          label={t('segment.accounts')}
          value={formatNumber(board.teacher.accounts, locale)}
        />
        <SegRow label={t('segment.mrr')} value={formatCurrency(board.teacher.mrr, locale)} />
        <SegRow
          label={t('segment.revenueThisMonth')}
          value={formatCurrency(board.teacher.revenue_this_month, locale)}
        />
      </div>

      {/* 6 · Churn and ARPU — each dropped when its denominator is unknown */}
      {(board.churn_rate_pct != null || board.arpu != null) && (
        <div className="grid grid-cols-2 gap-2">
          {board.churn_rate_pct != null && (
            <Kpi
              label={t('kpi.centerChurn')}
              value={formatPercent(board.churn_rate_pct, locale, {
                maximumFractionDigits: 1,
              })}
            />
          )}
          {board.arpu != null && (
            <Kpi label={t('kpi.arpu')} value={formatCurrency(board.arpu, locale)} />
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--color-text-tertiary)] mx-1">
        {t('basis')}
      </p>
    </section>
  );
}
