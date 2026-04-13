'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';
import { supabase } from '@/lib/supabase';
import { useBranchStore } from '@/stores/branchStore';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from '@/i18n/routing';
import { Loader2, Gift, TrendingUp, DollarSign, Users, BookOpen } from 'lucide-react';
import { BarChartComponent } from '@/components/charts';

interface BenchmarkMetric {
  your_value: number;
  district_avg: number | null;
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
      className="w-28 h-28 mx-auto text-teal-600 dark:text-teal-400"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="24" y="52" width="12" height="36" rx="2" className="fill-teal-500/25 stroke-teal-600 dark:stroke-teal-400" strokeWidth="2" />
      <rect x="44" y="40" width="12" height="48" rx="2" className="fill-teal-500/35 stroke-teal-600 dark:stroke-teal-400" strokeWidth="2" />
      <rect x="64" y="60" width="12" height="28" rx="2" className="fill-teal-500/20 stroke-slate-400 dark:stroke-slate-500" strokeWidth="2" />
      <rect x="84" y="48" width="12" height="40" rx="2" className="fill-teal-500/30 stroke-teal-600 dark:stroke-teal-400" strokeWidth="2" />
      <rect x="38" y="28" width="44" height="34" rx="6" className="fill-slate-200/90 dark:fill-slate-700 stroke-slate-500 dark:stroke-slate-400" strokeWidth="2" />
      <path
        d="M52 44h16v10c0 4-3.5 7-8 7s-8-3-8-7V44z"
        className="fill-slate-500 dark:fill-slate-300"
      />
      <circle cx="60" cy="56" r="3" className="fill-slate-800 dark:fill-slate-100" />
    </svg>
  );
}

export default function BenchmarksPage() {
  const t = useTranslations('benchmarks');
  const tc = useTranslations('common');
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
    () => (n: number) =>
      `${formatNumber(Math.round(n * 1000) / 10, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
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

  if (d.insufficient_data) {
    const centersNeeded = d.centers_needed ?? 10;
    const isNoDistrict = d.reason === 'no_district';
    const currentCenters =
      d.center_count != null ? d.center_count : Math.max(1, DISTRICT_TARGET - centersNeeded);
    const progressPct = Math.min(100, Math.round((currentCenters / DISTRICT_TARGET) * 100));

    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] px-4 py-6 md:py-10">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="max-w-md mx-auto text-center pt-10 md:pt-16">
          <BenchmarkLockIllustration />
          <h2 className="text-xl font-bold text-[var(--color-text-primary)] mt-6">{t('districtTitle')}</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">{t('emptySubheading')}</p>

          <div className="mt-8 text-start">
            <div className="flex justify-between text-xs font-medium text-[var(--color-text-muted)] mb-1">
              <span>
                {t('progressLabel', {
                  current: formatNumber(currentCenters, locale),
                  total: formatNumber(DISTRICT_TARGET, locale),
                })}
              </span>
              <span className="tabular-nums">{formatNumber(progressPct, locale)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

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
              className="text-sm font-medium text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center justify-center gap-1"
            >
              {t('learnMore')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const cards: {
    key: string;
    icon: React.ElementType;
    metric: BenchmarkMetric | undefined;
    format: (n: number) => string;
    descKey: string;
  }[] = [
    { key: 'attendance', icon: TrendingUp, metric: d.attendance, format: formatPct, descKey: 'attendanceDesc' },
    { key: 'revenue', icon: DollarSign, metric: d.revenue_per_student, format: formatEgp, descKey: 'revenueDesc' },
    { key: 'retention', icon: Users, metric: d.retention_30d, format: formatPct, descKey: 'retentionDesc' },
    { key: 'utilization', icon: BookOpen, metric: d.group_utilization, format: formatPct, descKey: 'utilizationDesc' },
  ];

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map(({ key, icon: Icon, metric, format, descKey }) => {
          if (!metric) return null;
          const yourVal = Number(metric.your_value ?? 0);
          const avgVal = Number(metric.district_avg ?? 0);
          const pct = Math.min(100, Math.max(0, Number(metric.percentile ?? 0)));
          return (
            <div
              key={key}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 card-shadow"
            >
              <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-sm mb-2">
                <Icon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                {t(key)}
              </div>
              <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-1">{format(yourVal)}</p>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                {t('districtAvg')}: {format(avgVal)}
              </p>
              <div className="h-2 bg-[var(--color-surface-3)] rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                {t(descKey, { percentile: formatNumber(pct, locale) })}
              </p>
              {(() => {
                const isMoney = key === 'revenue';
                const youN = isMoney ? yourVal : yourVal * 100;
                const distN = isMoney ? avgVal : avgVal * 100;
                const barData = [
                  { label: t('comparisonYou'), v: youN },
                  { label: t('districtAvg'), v: distN },
                ];
                return (
                  <BarChartComponent
                    data={barData}
                    xKey="label"
                    dataKey="v"
                    height={160}
                    color="teal"
                    showGrid={false}
                    radius={6}
                    prefix={isMoney ? 'EGP ' : ''}
                    suffix={isMoney ? '' : '%'}
                  />
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
