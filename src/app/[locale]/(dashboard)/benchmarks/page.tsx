'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistrictDisplay } from '@/lib/formatDistrict';
import { formatNumber, formatPercent } from '@/lib/formatNumber';
import { supabase } from '@/lib/supabase';
import { useBranchStore } from '@/stores/branchStore';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from '@/i18n/routing';
import { Loader2, Gift } from 'lucide-react';

interface BenchmarkMetric {
  your_value: number;
  district_avg: number | null;
  /**
   * The district's p50 for this metric. §02 compares every row against the
   * local MEDIAN, not the mean — `/api/benchmarks` now reads `p50_*` off
   * `benchmark_snapshots` (columns confirmed live) and attaches it here. Stays
   * optional: a snapshot row can carry a NULL p50, and the row must then drop
   * the median line rather than print a zero that reads as a real median.
   */
  district_median?: number | null;
  percentile: number;
}

interface BenchmarksData {
  insufficient_data: boolean;
  centers_needed?: number;
  reason?: 'no_district' | string;
  district?: string;
  tier?: string;
  center_count?: number;
  snapshot_date?: string;
  attendance?: BenchmarkMetric;
  revenue_per_student?: BenchmarkMetric;
  retention_30d?: BenchmarkMetric;
  group_utilization?: BenchmarkMetric;
}

const DISTRICT_TARGET = 10;

function BenchmarkLockIllustration() {
  return (
    <svg
      className="w-28 h-28 mx-auto text-teal-600"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="24" y="52" width="12" height="36" rx="2" className="fill-teal-500/25 stroke-teal-600" strokeWidth="2" />
      <rect x="44" y="40" width="12" height="48" rx="2" className="fill-teal-500/35 stroke-teal-600" strokeWidth="2" />
      <rect x="64" y="60" width="12" height="28" rx="2" className="fill-teal-500/20 stroke-slate-400" strokeWidth="2" />
      <rect x="84" y="48" width="12" height="40" rx="2" className="fill-teal-500/30 stroke-teal-600" strokeWidth="2" />
      <rect x="38" y="28" width="44" height="34" rx="6" className="fill-slate-200/90 stroke-slate-500" strokeWidth="2" />
      <path
        d="M52 44h16v10c0 4-3.5 7-8 7s-8-3-8-7V44z"
        className="fill-slate-500"
      />
      <circle cx="60" cy="56" r="3" className="fill-slate-800" />
    </svg>
  );
}

function hasAnyMetric(d: BenchmarksData): boolean {
  return !!(d.attendance || d.revenue_per_student || d.retention_30d || d.group_utilization);
}

export default function BenchmarksPage() {
  const t = useTranslations('benchmarks');
  const tc = useTranslations('common');
  const tDistricts = useTranslations('settings.districts');
  const locale = useLocale();
  const { activeCenterId } = useBranchStore();
  const [data, setData] = useState<BenchmarksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    setError(null);
    try {
      const url = activeCenterId ? `/api/benchmarks?center_id=${activeCenterId}` : '/api/benchmarks';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [activeCenterId, tc]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatEgp = (n: number) => `${formatNumber(n, locale)} ${tc('egp')}`;
  const formatPct = useMemo(
    () => (n: number) => formatPercent(Math.round(n * 1000) / 10, locale),
    [locale],
  );

  if (loading && !data) {
    return (
      <div className="p-6 flex min-h-screen w-full items-center justify-center bg-[var(--color-surface-0)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-secondary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const d = data ?? { insufficient_data: true, centers_needed: 10 };
  const districtNorm = String(d.district ?? '').trim();
  const isNoDistrict = !districtNorm || d.reason === 'no_district';
  const showLiveBenchmarks = !d.insufficient_data && !isNoDistrict;

  /**
   * §02's header subtitle. The design names the district in the topbar of BOTH
   * frames — `Merged-Center-Insight.html` L409 (`add-on · locked`) and L435
   * (`enabled · fitted`) both read "vs centers in Nasr City" — so the locked
   * screen gets it too, as long as a district is actually known.
   *
   * Label resolution, in order: the localized `settings.districts.<slug>` entry
   * (which is where the ten seeded districts live in both locales), then
   * `formatDistrictDisplay` for a slug nobody has translated yet, so a district
   * added to the DB later degrades to `some_slug` → "Some Slug" rather than
   * rendering a raw slug or a missing-key crash.
   *
   * When no district is set at all there is nothing to name, so the existing
   * "set your district" prompt stays — that is a call to action, not a label.
   */
  const districtLabel = districtNorm
    ? tDistricts.has(districtNorm)
      ? tDistricts(districtNorm)
      : formatDistrictDisplay(districtNorm)
    : '';
  const headerSubtitle = districtLabel
    ? t('subtitleWithDistrict', { district: districtLabel })
    : isNoDistrict
      ? t('noDistrictSubtitle')
      : t('subtitle');

  /** API mismatch: metrics without an unlocked district - show sample overlay only. */
  const sampleOnlyMode = !showLiveBenchmarks && hasAnyMetric(d);

  /**
   * Overall standing — design (Merged-Center-Insight §02) opens the screen with
   * one headline rank before the per-metric detail, so the owner gets an answer
   * without reading four cards.
   *
   * Derived, not stored: the mean of whichever metric percentiles the RPC
   * returned. get_center_benchmarks returns exactly four (attendance,
   * revenue_per_student, retention_30d, group_utilization) — verified against
   * pg_proc — and the design's other two, average fee and new students/month,
   * exist nowhere in benchmark_snapshots. See Appendix D9.
   */
  const overall = (() => {
    const pcts = [d.attendance, d.revenue_per_student, d.retention_30d, d.group_utilization]
      .filter((m): m is BenchmarkMetric => Boolean(m))
      .map((m) => Math.min(100, Math.max(0, Number(m.percentile ?? 0))));
    if (pcts.length === 0) return null;
    return pcts.reduce((a, b) => a + b, 0) / pcts.length;
  })();

  const cards: {
    key: string;
    metric: BenchmarkMetric | undefined;
    format: (n: number) => string;
    descKey: string;
  }[] = [
    { key: 'attendance', metric: d.attendance, format: formatPct, descKey: 'attendanceDesc' },
    { key: 'revenue', metric: d.revenue_per_student, format: formatEgp, descKey: 'revenueDesc' },
    { key: 'retention', metric: d.retention_30d, format: formatPct, descKey: 'retentionDesc' },
    { key: 'utilization', metric: d.group_utilization, format: formatPct, descKey: 'utilizationDesc' },
  ];

  /**
   * §02 opens on a teal gradient `.hero`, not a plain surface card: the
   * standing is the one figure the screen exists to deliver, and the design
   * gives it the only filled panel on the page. The `.youmark` is a circular
   * marker riding a translucent `.postbar`, positioned with a logical inset so
   * it mirrors under RTL the way the design's AR frame draws it (`right:85%`).
   */
  const standingCard =
    overall === null ? null : (
      <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 p-4 text-white card-shadow mb-6">
        <p className="text-xs opacity-85">{t('overallStanding')}</p>
        <p className="text-3xl font-bold leading-tight mt-0.5">
          {t('topPercent', { percent: formatPercent(Math.round(100 - overall), locale) })}
        </p>
        {d.center_count != null && (
          <p className="text-[11px] opacity-85 mt-0.5">
            {t('acrossCenters', { count: formatNumber(d.center_count, locale) })}
          </p>
        )}
        <div className="mt-3">
          <div className="relative h-2.5 rounded-full bg-white/20">
            <span
              aria-hidden
              className="absolute -top-1 h-4.5 w-4.5 rounded-full border-[3px] border-teal-800 bg-white shadow"
              style={{ insetInlineStart: `calc(${Math.min(100, Math.max(0, overall))}% - 9px)` }}
            />
          </div>
          <div className="flex justify-between text-[10px] opacity-75 mt-2">
            <span>{t('scaleLower')}</span>
            <span>{t('scaleMedian')}</span>
            <span>{t('scaleHigher')}</span>
          </div>
        </div>
      </div>
    );

  /**
   * §02's "How you compare" is ONE card of compact `.bmrow` rows — metric name,
   * rank pill, a "you vs median" line and a percentile track with the median
   * ticked — not one large card per metric. The per-metric two-bar
   * you-vs-district chart the screen used to draw is dropped with it: it
   * restated exactly what the track already shows, and the design does not have
   * it.
   *
   * The four metrics are the four `get_center_benchmarks` actually returns
   * (verified against `pg_get_functiondef`, not assumed). The design's fifth
   * and sixth rows — average fee, new students/month — are the already-decided
   * design error (`NEW-FEATURES.md` Appendix D9): build the real four, fix the
   * drawing. Still not built here, deliberately.
   */
  const chartGrid = (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 card-shadow">
      {cards.map(({ key, metric, format, descKey }) => {
        if (!metric) return null;
        const yourVal = Number(metric.your_value ?? 0);
        const avgVal = Number(metric.district_avg ?? 0);
        const pct = Math.min(100, Math.max(0, Number(metric.percentile ?? 0)));
        const medianVal =
          metric.district_median === null || metric.district_median === undefined
            ? null
            : Number(metric.district_median);
        /* §02's down-state: a metric under the district median draws a gold
           fill and a "Below median" pill instead of a "Top X%" one. Percentile
           < 50 IS below the median by definition — the same number already
           driving the bar, read the other way, not a second computation. */
        const belowMedian = pct < 50;
        return (
          <div key={key} className="border-t border-[var(--color-border)] py-3 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t(key)}</span>
              {/* Design leads each row with the rank, not the raw value. */}
              {belowMedian ? (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-3 py-0.5 text-[11px] font-semibold text-amber-700">
                  {t('belowMedian')}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-teal-500/12 px-3 py-0.5 text-[11px] font-semibold text-teal-700">
                  {t('topPercent', { percent: formatPercent(Math.round(100 - pct), locale) })}
                </span>
              )}
            </div>
            {/* §02's "You 18,400 · median 14,200 EGP" line. The median half is
                drawn only when the snapshot carried a p50 for this metric — a
                NULL p50 drops the clause rather than printing a zero that would
                read as a real district median. The district mean stays on the
                line too: it is a different statistic, and the screen has always
                shown it. */}
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 tabular-nums">
              {t('comparisonYou')} {format(yourVal)}
              {medianVal !== null ? ` · ${t('scaleMedian')} ${format(medianVal)}` : ''}
              {` · ${t('districtAvg')} ${format(avgVal)}`}
            </p>
            <div className="relative h-2 bg-[var(--color-surface-3)] rounded-full mt-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  belowMedian ? 'bg-amber-500' : 'bg-teal-500'
                }`}
                style={{ width: `${pct}%` }}
              />
              {/* The median tick the design marks on every track. The scale is
                  a percentile scale, so the median sits at 50% by definition —
                  a fixed reference mark, not a value read off the data. */}
              <span
                aria-hidden
                className="absolute w-0.5 rounded-full bg-[var(--color-text-muted)]"
                style={{ insetInlineStart: '50%', top: '-3px', height: '14px' }}
              />
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-2">
              {t(descKey, { percentile: formatPercent(pct, locale) })}
            </p>
          </div>
        );
      })}
    </div>
  );

  if (sampleOnlyMode) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6">
        <PageHeader title={t('title')} subtitle={t('sampleSubtitle')} />
        <div className="relative rounded-2xl border border-dashed border-amber-400/50 bg-amber-50/40 p-4 mb-4">
          <p className="text-sm text-[var(--color-text-secondary)]">{t('sampleBanner')}</p>
          <Link
            href="/settings"
            className="inline-flex mt-3 px-4 py-2 rounded-lg bg-teal-600 text-primary-foreground text-sm font-semibold hover:bg-teal-700"
          >
            {t('settingsCta')}
          </Link>
        </div>
        <div className="relative">
          <div className="opacity-35 pointer-events-none select-none grayscale">
            {standingCard}
            {chartGrid}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--color-surface-0)]/80 backdrop-blur-[2px]">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] px-4 text-center">{t('sampleOverlay')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!showLiveBenchmarks) {
    const centersNeeded = d.centers_needed ?? 10;
    const currentCenters =
      d.center_count != null ? d.center_count : Math.max(1, DISTRICT_TARGET - centersNeeded);
    const progressPct = Math.min(100, Math.round((currentCenters / DISTRICT_TARGET) * 100));

    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] px-4 py-6 md:py-10">
        <PageHeader title={t('title')} subtitle={headerSubtitle} />
        <div className="max-w-md mx-auto text-center pt-10 md:pt-16">
          <BenchmarkLockIllustration />
          <h2 className="text-xl font-bold text-[var(--color-text-primary)] mt-6">{t('districtTitle')}</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">{t('emptySubheading')}</p>

          {!isNoDistrict ? (
            <div className="mt-8 text-start">
              <div className="flex justify-between text-xs font-medium text-[var(--color-text-muted)] mb-1">
                <span>
                  {t('progressLabel', {
                    current: formatNumber(currentCenters, locale),
                    total: formatNumber(DISTRICT_TARGET, locale),
                  })}
                </span>
                <span className="tabular-nums">{formatPercent(progressPct, locale)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : null}

          <p className="text-sm text-[var(--color-text-muted)] mt-6 leading-relaxed">
            {isNoDistrict ? t('noDistrict') : t('emptyBody')}
          </p>

          <div className="mt-8 flex flex-col gap-3 items-stretch">
            {isNoDistrict ? (
              <Link
                href="/settings"
                className="btn-lift inline-flex items-center justify-center px-6 py-3 bg-teal-600 hover:bg-teal-700 text-primary-foreground font-semibold rounded-xl transition-colors"
              >
                {t('settingsCta')}
              </Link>
            ) : (
              <Link
                href="/referrals"
                className="btn-lift inline-flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-primary-foreground font-semibold rounded-xl transition-colors"
              >
                <Gift size={20} />
                {t('referEarnCta')}
              </Link>
            )}
            <Link
              href="/settings"
              className="text-sm font-medium text-teal-600 hover:underline inline-flex items-center justify-center gap-1"
            >
              {t('learnMore')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6">
      <PageHeader title={t('title')} subtitle={headerSubtitle} />
      {standingCard}
      <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3">
        {t('howYouCompare')}
      </h2>
      {chartGrid}
      {/* The design closes the screen on this reassurance, and it earns its
          place: a center is being ranked against its neighbours and wants to
          know the ranking is not visible to them. */}
      <p className="text-xs text-[var(--color-text-muted)] mt-6 text-center">{t('anonymityNote')}</p>
    </div>
  );
}
