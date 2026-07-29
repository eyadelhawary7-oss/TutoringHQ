'use client';

/**
 * `Merged-Admin-Platform` §02 — the growth header and the breakdown lists.
 *
 * The design's two frames in the design's order: the All / Centers / Teachers
 * segment, the MRR hero with month-over-month, the four growth tiles, then
 * TOP BY REVENUE and BY PLAN. The live screen's ratio KPIs and status donuts
 * stay underneath.
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
 *  - **Per-account student counts in TOP BY REVENUE.** The design shows
 *    "240 students" per row; that needs a per-centre roll-up this endpoint does
 *    not compute, so the rows carry plan and MRR, which are real.
 */

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { ListRow } from '@/components/patterns';
import { initialsOf } from '@/lib/initials';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';
import type { CustomerSplitView } from '@/components/admin/PlatformOverviewHeader';

export interface TopAccountView {
  id: string;
  name: string | null;
  kind: 'center' | 'teacher';
  plan: string | null;
  mrr: number;
}

export interface PlanCountView {
  plan: string;
  accounts: number;
}

interface Props {
  split: CustomerSplitView | null;
  topByRevenue: TopAccountView[] | null;
  planMix: PlanCountView[] | null;
  mrrGrowthPct: number | null;
  churnRatePct: number | null;
  planLabel: (planKey: string) => string;
}

type Segment = 'all' | 'centers' | 'teachers';

export default function AnalyticsGrowthHeader({
  split,
  topByRevenue,
  planMix,
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
                meta={[
                  row.kind === 'teacher' ? t('kindTeacher') : t('kindCenter'),
                  row.plan ? planLabel(row.plan) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {planMix.map((row, i) => (
              <div
                key={row.plan}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-[var(--color-border)]' : ''
                }`}
              >
                <span className="text-sm text-[var(--color-text-primary)]">{planLabel(row.plan)}</span>
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {t('accountsCount', { count: formatNumber(row.accounts, locale) })}
                </span>
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
