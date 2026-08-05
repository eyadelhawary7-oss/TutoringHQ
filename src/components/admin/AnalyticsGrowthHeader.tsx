'use client';

/**
 * `Merged-Admin-Platform` §02 — the growth header and the breakdown lists.
 *
 * The design's two frames in the design's order: the All / Centers / Teachers
 * segment, the MRR hero with month-over-month, the "Revenue, last 6 months"
 * chart, the four growth tiles, then TOP BY REVENUE and BY PLAN. The live
 * screen's ratio KPIs and status donuts stay underneath.
 *
 * The six-month chart is NOT a new figure. `/api/admin/overview` has always
 * returned `monthlyRevenue` — six `{ month, revenue }` buckets summed from paid
 * `invoices.payment_amount` — and `/admin` already charts it. §02 drew the same
 * block and simply never rendered it here. It is labelled "revenue collected",
 * not MRR: the hero above it is recurring revenue and these bars are cash in,
 * two different measures that must not be read as one series.
 *
 * The segment filters the FIGURES, not just a list — picking Centers shows the
 * centre MRR, centre accounts and centre ARPU, because a segmented control that
 * only reorders a list while the headline number stays global is the kind of
 * thing that gets read wrong in a board meeting.
 *
 * OMITTED, with the reason:
 *  - **"Platform fees" in the design's revenue breakdown.** The processing fee
 *    is snapshotted into `invoices.metadata.processing_fee`, a jsonb key with no
 *    column and no aggregate anywhere in the product. Summing it would mean
 *    parsing metadata per invoice and inventing the total the design shows.
 *
 * TOP BY REVENUE's student counts: the design shows "<plan> · 240 students" on
 * centre rows only — its one teacher row reads "Teacher · <plan>", no count —
 * and that split is intentional here too. `fetchCenterStudentCounts` fills a
 * real, `is_active = true` count for the ranked centre rows; teacher rows never
 * carry one, matching the design.
 */

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { ListRow } from '@/components/patterns';
import { initialsOf } from '@/lib/initials';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';
import { barHeightPct, monthLabel } from '@/lib/adminPlatformDisplay';
import type { CustomerSplitView } from '@/components/admin/PlatformOverviewHeader';

export interface TopAccountView {
  id: string;
  name: string | null;
  kind: 'center' | 'teacher';
  plan: string | null;
  /** Active student count. Centre rows only — teacher rows never carry one, matching the design. */
  students: number | null;
  mrr: number;
}

export interface PlanCountView {
  plan: string;
  accounts: number;
}

/** One bucket of `/api/admin/overview`'s `monthlyRevenue`. `month` is `YYYY-MM`. */
export interface MonthlyRevenueView {
  month: string;
  revenue: number;
}

interface Props {
  split: CustomerSplitView | null;
  topByRevenue: TopAccountView[] | null;
  planMix: PlanCountView[] | null;
  monthlyRevenue: MonthlyRevenueView[] | null;
  mrrGrowthPct: number | null;
  churnRatePct: number | null;
  planLabel: (planKey: string) => string;
}

type Segment = 'all' | 'centers' | 'teachers';

export default function AnalyticsGrowthHeader({
  split,
  topByRevenue,
  planMix,
  monthlyRevenue,
  mrrGrowthPct,
  churnRatePct,
  planLabel,
}: Props) {
  const t = useTranslations('admin.platformAnalytics');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [segment, setSegment] = useState<Segment>('all');

  const figures = useMemo(() => {
    if (!split) return null;
    if (segment === 'centers') {
      return { mrr: split.centers.mrr, accounts: split.centers.accounts };
    }
    if (segment === 'teachers') {
      return { mrr: split.teachers.mrr, accounts: split.teachers.accounts };
    }
    return { mrr: split.totalMrr, accounts: split.totalAccounts };
  }, [split, segment]);

  const rankedRows = useMemo(() => {
    const rows = topByRevenue ?? [];
    if (segment === 'centers') return rows.filter((r) => r.kind === 'center');
    if (segment === 'teachers') return rows.filter((r) => r.kind === 'teacher');
    return rows;
  }, [topByRevenue, segment]);

  const months = monthlyRevenue ?? [];
  const maxMonthRevenue = months.reduce((max, m) => Math.max(max, Number(m.revenue) || 0), 0);
  const maxPlanAccounts = (planMix ?? []).reduce((max, p) => Math.max(max, p.accounts), 0);

  if (!split || !figures) return null;

  // ARPU is MRR ÷ paying accounts. Zero accounts has no ARPU — dividing would
  // give Infinity or NaN, and 0 would read as "our customers pay nothing".
  const arpu = figures.accounts > 0 ? Math.round(figures.mrr / figures.accounts) : null;

  return (
    <section className="mb-6 space-y-5">
      <div
        role="tablist"
        aria-label={t('segmentLabel')}
        className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-1"
      >
        {(['all', 'centers', 'teachers'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={segment === s}
            onClick={() => setSegment(s)}
            className={`btn-press chq-focus min-h-[40px] rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              segment === s
                ? 'bg-teal-600 text-white'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
            }`}
          >
            {t(`segment_${s}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">{t('mrrHeading')}</p>
        <div className="mt-1 flex items-baseline justify-center gap-2">
          <p className="text-3xl font-bold text-[var(--color-text-primary)]">
            {formatCurrency(figures.mrr, locale)}
          </p>
          {/*
            Growth is a whole-platform figure. It is shown only on All, because
            attributing platform-wide month-over-month change to one segment
            would be a number the data does not support.
          */}
          {segment === 'all' && mrrGrowthPct != null && (
            <span
              className={`text-sm font-semibold ${
                mrrGrowthPct >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {mrrGrowthPct >= 0 ? '+' : '−'}
              {formatPercent(Math.abs(mrrGrowthPct), locale)}
            </span>
          )}
        </div>
      </div>

      {/*
        "Revenue, last 6 months". The design's own caption is just "Revenue" —
        spelled out here as collected revenue because it sits directly under an
        MRR hero and the two are different measures.

        The segment above does NOT filter this: `monthlyRevenue` is summed from
        paid invoices with no centre/teacher split, so re-labelling it under
        Centers or Teachers would attribute a total to a segment the data does
        not break down. It stays whole-platform, like the growth badge.
      */}
      {months.length > 0 && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('revenueLastMonthsHeading', { count: formatNumber(months.length, locale) })}
          </p>
          <div className="mt-4 flex h-32 items-end gap-2" role="presentation">
            {months.map((m) => (
              <div
                key={m.month}
                className="flex min-w-0 flex-1 items-end self-stretch rounded-t-md bg-[var(--color-surface-2)]"
              >
                <div
                  className={`w-full rounded-t-md ${
                    m.month === months[months.length - 1]?.month
                      ? 'bg-[var(--color-brand-500)]'
                      : 'bg-[var(--color-mint)]'
                  }`}
                  style={{ height: `${barHeightPct(m.revenue, maxMonthRevenue)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {months.map((m) => (
              <span
                key={m.month}
                className="min-w-0 flex-1 truncate text-center text-[11px] text-[var(--color-text-muted)]"
              >
                {monthLabel(m.month, locale)}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            {t('revenueLastMonthsNote', {
              amount: formatCurrency(months[months.length - 1]?.revenue ?? 0, locale),
            })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile value={formatNumber(figures.accounts, locale)} label={t('activeAccounts')} />
        <Tile
          value={`+${formatNumber(split.newAccountsThisMonth, locale)}`}
          label={t('newThisMonth')}
        />
        <Tile
          value={churnRatePct != null ? formatPercent(churnRatePct, locale) : '—'}
          label={t('churn')}
        />
        <Tile value={arpu != null ? formatCurrency(arpu, locale) : '—'} label={t('arpu')} />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {t('topByRevenueHeading')}
        </h3>
        {rankedRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('topEmptyTitle')}
            description={t('topEmptyBody')}
            alt={t('topEmptyAlt')}
          />
        ) : (
          <div className="space-y-2">
            {rankedRows.map((row) => (
              <ListRow
                key={`${row.kind}-${row.id}`}
                avatar={initialsOf(row.name ?? '')}
                title={row.name ?? tCommon('notSet')}
                // The design reads "<plan> · N students" on centre rows (no kind
                // label) and "Teacher · <plan>" on teacher rows (no count) — kept
                // asymmetric here rather than forcing one shape on both.
                meta={
                  row.kind === 'teacher'
                    ? [t('kindTeacher'), row.plan ? planLabel(row.plan) : null]
                        .filter(Boolean)
                        .join(' · ')
                    : [
                        row.plan ? planLabel(row.plan) : null,
                        row.students != null
                          ? t('studentsCount', { count: formatNumber(row.students, locale) })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                }
                badge={
                  <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                    {formatCurrency(row.mrr, locale)}
                  </span>
                }
                chevron={false}
              />
            ))}
          </div>
        )}
      </div>

      {planMix && planMix.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('byPlanHeading')}
          </h3>
          {/*
            The design draws each plan as a label/count row over a filled
            track. The track is proportional to the LARGEST plan, not to the
            total: with four plans a share-of-total bar is a sliver at every
            realistic mix and stops being readable, which is the one job it has.
          */}
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {planMix.map((row, i) => (
              <div
                key={row.plan}
                className={`px-4 py-3 ${i > 0 ? 'border-t border-[var(--color-border)]' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-text-primary)]">{planLabel(row.plan)}</span>
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    {t('accountsCount', { count: formatNumber(row.accounts, locale) })}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand-500)]"
                    style={{ inlineSize: `${barHeightPct(row.accounts, maxPlanAccounts)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
      <p className="text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
