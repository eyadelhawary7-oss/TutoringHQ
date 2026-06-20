'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, Download, HandCoins, Loader2, Sprout, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/formatNumber';
import { cairoDateKey, parseCairoYmd } from '@/lib/cairo/day';
import IncomeLifetimeChart, { type IncomeMonth, type YearMonth } from './IncomeLifetimeChart';

type AllTimeData = {
  lifetime_total: number;
  best_month: { year: number; month: number; amount: number } | null;
  monthly_average: number;
  months_since_joined: number;
  monthly_series: IncomeMonth[];
};

type MethodBreakdown = {
  cash: number;
  instapay: number;
  vodafone_cash: number;
  other: number;
};

type MonthData = {
  collectedThisMonth: number;
  outstanding: number;
  methodBreakdown?: MethodBreakdown;
  groups: {
    id: string;
    name: string | null;
    collectedThisMonth: number;
    outstanding: number;
  }[];
};

/** Method buckets in display order, paired with their markPaid.* label key. */
const METHOD_ROWS: { key: keyof MethodBreakdown; labelKey: string }[] = [
  { key: 'cash', labelKey: 'markPaid.cash' },
  { key: 'instapay', labelKey: 'markPaid.instapay' },
  { key: 'vodafone_cash', labelKey: 'markPaid.vodafoneCash' },
  { key: 'other', labelKey: 'markPaid.other' },
];

function ymKey(ym: YearMonth): string {
  return `${ym.year}-${ym.month}`;
}

/** Noon UTC mid-month: safely inside the month on the Cairo calendar too. */
function monthAnchor(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month - 1, 15, 12, 0, 0));
}

function Skeleton({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] ${className}`}
    />
  );
}

/**
 * Private income view (State B only; the routes are gated by
 * requireTeacherPrivateAccess). Five zones: lifetime stat tiles, the
 * private/center split bar, the lifetime month-navigator chart, the monthly
 * collected/outstanding tiles, and the by-group breakdown. The chart selects
 * a month; zones 2, 4 and 5 follow the selection. period=all and
 * period=current load in parallel and each zone renders as its data lands.
 */
export default function IncomeView() {
  const t = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const current = useMemo<YearMonth>(() => {
    const { y, m } = parseCairoYmd(cairoDateKey());
    return { year: y, month: m };
  }, []);

  const [selected, setSelected] = useState<YearMonth>(current);
  const [allData, setAllData] = useState<AllTimeData | null>(null);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState(false);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState(false);
  const monthCache = useRef(new Map<string, MonthData>());

  // Split-bar segments animate from 0 on mount (CSS width transition).
  const [barMounted, setBarMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const authedFetch = useCallback(
    async (path: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return null;
      }
      const res = await fetch(path, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return null;
      }
      return res;
    },
    [router],
  );

  const loadAll = useCallback(async () => {
    setAllLoading(true);
    setAllError(false);
    try {
      const res = await authedFetch('/api/teacher/private/income?period=all');
      if (!res) return;
      if (!res.ok) {
        setAllError(true);
        return;
      }
      setAllData((await res.json()) as AllTimeData);
    } catch {
      setAllError(true);
    } finally {
      setAllLoading(false);
    }
  }, [authedFetch]);

  const loadMonth = useCallback(
    async (ym: YearMonth, isCurrent: boolean) => {
      const cached = monthCache.current.get(ymKey(ym));
      if (cached) {
        setMonthData(cached);
        setMonthLoading(false);
        setMonthError(false);
        return;
      }
      setMonthLoading(true);
      setMonthError(false);
      try {
        // The bare endpoint is the unchanged mode-1 contract; explicit
        // year/month switches to the month-window variant for past months.
        const path = isCurrent
          ? '/api/teacher/private/income'
          : `/api/teacher/private/income?period=current&year=${ym.year}&month=${ym.month}`;
        const res = await authedFetch(path);
        if (!res) return;
        if (!res.ok) {
          setMonthError(true);
          return;
        }
        const data = (await res.json()) as MonthData;
        monthCache.current.set(ymKey(ym), data);
        setMonthData(data);
      } catch {
        setMonthError(true);
      } finally {
        setMonthLoading(false);
      }
    },
    [authedFetch],
  );

  useEffect(() => {
    // Parallel on mount: zones 1-3 (all-time) and zones 4-5 (current month).
    loadAll();
    loadMonth(current, true);
  }, [loadAll, loadMonth, current]);

  const isCurrentSelected = selected.year === current.year && selected.month === current.month;

  const selectMonth = (ym: YearMonth) => {
    setSelected(ym);
    loadMonth(ym, ym.year === current.year && ym.month === current.month);
  };

  const runExport = async (mode: 'current' | 'all') => {
    setExportOpen(false);
    setExporting(true);
    setExportError(false);
    try {
      const qs =
        mode === 'all'
          ? `period=all&locale=${locale}`
          : `period=current&year=${selected.year}&month=${selected.month}&locale=${locale}`;
      const res = await authedFetch(`/api/teacher/private/income/export?${qs}`);
      if (!res) return;
      if (!res.ok) {
        setExportError(true);
        return;
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'centerhq-income.csv';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  // ---- Full-page terminal states ----

  if (allError && monthError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          onClick={() => {
            loadAll();
            loadMonth(selected, isCurrentSelected);
          }}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (allData && allData.monthly_series.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <Sprout size={28} className="mx-auto mb-3 text-[var(--color-teal-deep)]" aria-hidden />
        <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
          {t('income.emptyHistoryBody')}
        </p>
        <Link
          href="/teacher/groups"
          className="inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('income.goToGroups')}
        </Link>
      </div>
    );
  }

  const series = allData?.monthly_series ?? [];
  const selectedEntry = series.find(
    (s) => s.year === selected.year && s.month === selected.month,
  );
  const splitPrivate = selectedEntry?.private_collected ?? 0;
  const splitCenter = selectedEntry?.center_collected ?? 0;
  const splitTotal = splitPrivate + splitCenter;

  const viewingLabel = formatDate(monthAnchor(selected), locale, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Export (header area, end-aligned) */}
      <div className="-mt-2 flex items-center justify-end gap-3">
        {exportError && (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {t('income.exportError')}
          </p>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={exporting}
            aria-expanded={exportOpen}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Download size={14} aria-hidden />
            )}
            {t('income.export')}
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute end-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-card">
                <button
                  type="button"
                  onClick={() => runExport('current')}
                  className="block w-full px-3 py-2 text-start text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {t('income.exportThisMonth')}
                </button>
                <button
                  type="button"
                  onClick={() => runExport('all')}
                  className="block w-full px-3 py-2 text-start text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {t('income.exportAllTime')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zones 1-3: lifetime stats, split bar, month navigator */}
      {allLoading && !allData ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Skeleton className="col-span-2 h-24 sm:col-span-1" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-10" />
          <Skeleton className="h-60" />
        </>
      ) : allError || !allData ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
          <button
            onClick={loadAll}
            className="text-sm font-medium text-[var(--color-teal-deep)] hover:underline"
          >
            {t('retry')}
          </button>
        </div>
      ) : (
        <>
          {/* Zone 1: lifetime stats */}
          {allData.lifetime_total === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center text-sm text-[var(--color-text-secondary)]">
              {t('income.historyEmpty')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="col-span-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card sm:col-span-1">
                <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Wallet size={16} className="text-[var(--color-teal-deep)]" aria-hidden />
                  {t('income.lifetimeEarned')}
                </div>
                <p className="num text-2xl font-bold text-[var(--color-teal-deep)]">
                  {formatCurrency(allData.lifetime_total, locale)}
                </p>
              </div>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card">
                <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Trophy size={16} className="text-[var(--color-brass)]" aria-hidden />
                  {t('income.bestMonth')}
                </div>
                <p className="num text-2xl font-bold text-[var(--color-text-primary)]">
                  {allData.best_month ? formatCurrency(allData.best_month.amount, locale) : ''}
                </p>
                {allData.best_month && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {formatDate(
                      monthAnchor({
                        year: allData.best_month.year,
                        month: allData.best_month.month,
                      }),
                      locale,
                      { month: 'long', year: 'numeric' },
                    )}
                  </p>
                )}
              </div>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card">
                <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <TrendingUp size={16} className="text-[var(--color-teal-deep)]" aria-hidden />
                  {t('income.monthlyAverage')}
                </div>
                <p className="num text-2xl font-bold text-[var(--color-text-primary)]">
                  {formatCurrency(allData.monthly_average, locale)}
                </p>
              </div>
            </div>
          )}

          {/* Zone 2: private/center split bar for the selected month */}
          <div>
            <div className="flex h-3 w-full overflow-hidden rounded-md bg-[var(--color-surface-0)]">
              <div
                className="h-full bg-[var(--color-teal)]"
                style={{
                  width: barMounted && splitTotal > 0 ? `${(splitPrivate / splitTotal) * 100}%` : '0%',
                  transition: 'width 400ms ease',
                }}
              />
              <div
                className="h-full bg-[var(--color-brass)]"
                style={{
                  width: barMounted && splitTotal > 0 ? `${(splitCenter / splitTotal) * 100}%` : '0%',
                  transition: 'width 400ms ease',
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              {splitTotal > 0
                ? t('income.splitLegend', {
                    private: formatCurrency(splitPrivate, locale),
                    centers: formatCurrency(splitCenter, locale),
                    total: formatCurrency(splitTotal, locale),
                  })
                : t('income.splitEmpty')}
            </p>
          </div>

          {/* Zone 3: lifetime chart (month navigator) */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 shadow-card">
            {!isCurrentSelected && (
              <p className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">
                {t('income.viewing', { month: viewingLabel })}
              </p>
            )}
            <IncomeLifetimeChart
              series={series}
              selected={selected}
              current={current}
              onSelect={selectMonth}
            />
          </div>
        </>
      )}

      {/* Zones 4-5: monthly tiles + by-group breakdown */}
      {monthLoading && !monthData ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-28" />
        </>
      ) : monthError ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
          <button
            onClick={() => loadMonth(selected, isCurrentSelected)}
            className="text-sm font-medium text-[var(--color-teal-deep)] hover:underline"
          >
            {t('retry')}
          </button>
        </div>
      ) : monthData ? (
        <>
          <div>
            {!isCurrentSelected && (
              <p className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">
                {t('income.viewing', { month: viewingLabel })}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* ADR 031 signature money surface */}
              <div className="money-hero rounded-[var(--radius-card)] p-5">
                <div className="mb-1 flex items-center gap-2 text-sm text-[#dfeeeb]">
                  <Banknote size={16} aria-hidden />
                  {isCurrentSelected ? t('income.collectedThisMonth') : t('income.collected')}
                </div>
                <p className="num text-3xl font-bold">
                  {formatCurrency(monthData.collectedThisMonth, locale)}
                </p>
              </div>
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card">
                <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <HandCoins size={16} className="text-[var(--color-brass)]" aria-hidden />
                  {t('income.outstanding')}
                </div>
                <p className="num text-3xl font-bold text-[var(--color-text-primary)]">
                  {formatCurrency(monthData.outstanding, locale)}
                </p>
              </div>
            </div>
          </div>

          {monthData.methodBreakdown && monthData.collectedThisMonth > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
                {t('income.byMethod')}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {METHOD_ROWS.map(({ key, labelKey }) => (
                  <div
                    key={key}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
                  >
                    <p className="text-xs text-[var(--color-text-secondary)]">{t(labelKey)}</p>
                    <p className="num mt-0.5 font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(monthData.methodBreakdown![key], locale)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {monthData.groups.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
                {t('income.byGroup')}
              </h3>
              <ul className="flex flex-col gap-2">
                {monthData.groups.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
                  >
                    <span className="font-medium text-[var(--color-text-primary)]">{g.name}</span>
                    <span className="flex items-center gap-4 text-sm">
                      <span className="text-[var(--color-text-secondary)]">
                        {t('income.collectedShort')}{' '}
                        <span className="font-semibold text-[var(--color-text-primary)]">
                          {formatCurrency(g.collectedThisMonth, locale)}
                        </span>
                      </span>
                      <span className="text-[var(--color-text-secondary)]">
                        {t('income.outstandingShort')}{' '}
                        <span className="font-semibold text-[var(--color-warning)]">
                          {formatCurrency(g.outstanding, locale)}
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
