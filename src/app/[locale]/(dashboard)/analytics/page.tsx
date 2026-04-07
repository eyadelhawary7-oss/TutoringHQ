'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import AgingReport from '@/components/analytics/AgingReport';
import PnLCard from '@/components/analytics/PnLCard';
import AnalyticsAiChatWidget from '@/components/analytics/AnalyticsAiChatWidget';
import { chartColors, colors } from '@/lib/tokens';
import { TrendingUp, Percent, Users, Wallet } from 'lucide-react';
import { ChartCard, ChartLegend } from '@/components/charts';

const RevenueByGroup = dynamic(() => import('@/components/charts/RevenueByGroup'), {
  ssr: false,
  loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" />,
});
const RevenueAreaChart = dynamic(
  () => import('@/components/analytics/RevenueAreaChart').then((m) => ({ default: m.RevenueAreaChart })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const PaymentDonutChart = dynamic(
  () => import('@/components/analytics/PaymentDonutChart').then((m) => ({ default: m.PaymentDonutChart })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const AttendanceHeatmap = dynamic(
  () => import('@/components/analytics/AttendanceHeatmap').then((m) => ({ default: m.AttendanceHeatmap })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);

interface AnalyticsData {
  mrr: number;
  outstanding_total: number;
  collection_rate: number;
  avg_payment_per_student: number;
  revenue_by_group: { group_id: string; group_name: string; amount: number }[];
  mrr_trend: { month: string; amount: number }[];
  payment_method_distribution: { method: string; amount: number }[];
  attendance_heatmap?: { day: number; week: number; count: number }[];
  aging_report: { student_id: string; student_name: string; group_name: string; days_overdue: number; amount: number }[];
  income_by_month: Record<string, number>;
  expenses_by_month: Record<string, { rent: number; salaries: number; utilities: number; other: number }>;
  pnl_months: string[];
}

const DONUT_PALETTE = [
  chartColors.primary,
  chartColors.secondary,
  chartColors.success,
  colors.state.info,
  chartColors.muted,
  colors.brand[400],
  colors.gold[400],
  colors.brand[300],
];

export default function AnalyticsPage() {
  const ta = useTranslations('analytics');
  const tCharts = useTranslations('charts');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const canViewRevenue = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_view_revenue');

  const [data, setData] = useState<AnalyticsData | null>(null);
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
      const res = await fetch('/api/analytics/revenue', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    if (!canViewRevenue) return;
    loadData();
  }, [canViewRevenue, loadData]);

  const d = useMemo(
    () =>
      data ?? {
        mrr: 0,
        outstanding_total: 0,
        collection_rate: 0,
        avg_payment_per_student: 0,
        revenue_by_group: [],
        mrr_trend: [],
        payment_method_distribution: [],
        attendance_heatmap: [],
        aging_report: [],
        income_by_month: {},
        expenses_by_month: {},
        pnl_months: [],
      },
    [data]
  );

  const months = ta.raw('months') as string[];

  const revenueData = useMemo(() => {
    return d.mrr_trend.map(({ month, amount }) => {
      const parts = month.split('-');
      const y = parts[0];
      const m = parts[1] ? parseInt(parts[1], 10) - 1 : -1;
      const label = m >= 0 && months[m] != null ? `${months[m]} ${y}` : month;
      return { month: label, revenue: amount };
    });
  }, [d.mrr_trend, months]);

  const mrrDelta = useMemo(() => {
    const t = d.mrr_trend;
    if (!t || t.length < 2) return undefined;
    const last = t[t.length - 1].amount;
    const prev = t[t.length - 2].amount;
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }, [d.mrr_trend]);

  const totalRevenue = useMemo(() => d.mrr_trend.reduce((s, x) => s + (x.amount ?? 0), 0), [d.mrr_trend]);

  const donutData = useMemo(() => {
    return d.payment_method_distribution.map((p, i) => ({
      name: p.method,
      value: p.amount,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  }, [d.payment_method_distribution]);

  const heatmapCells = d.attendance_heatmap ?? [];

  if (!canViewRevenue) {
    return (
      <div className="p-6">
        <p className="text-[var(--color-text-secondary)]">{ta('noAccess')}</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto" aria-busy>
        <div className="skeleton h-8 w-48 rounded-md" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
        <div className="skeleton h-40 w-full rounded-xl" />
        <div className="skeleton h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const egp = tCommon('egp');

  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen w-full page-enter max-md:pb-[calc(56px+env(safe-area-inset-bottom,0px)+0.5rem)] md:pb-28">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between px-4 pt-4 pb-4 no-print border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">{ta('title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">{ta('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center justify-center gap-2 self-stretch sm:self-auto sm:ms-auto px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-[var(--color-surface-1)] text-slate-800 dark:text-white text-sm font-semibold shadow-sm hover:border-teal-500/40 dark:hover:border-teal-400/30 transition-colors"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          {ta('export_pdf')}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 mt-4 mb-4 chart-animate">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] p-4 card-shadow btn-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-medium">{ta('mrr')}</span>
              <span className="block text-xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {Number(d.mrr ?? 0).toLocaleString('en-US')}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ms-1">{egp}</span>
              </span>
              {mrrDelta !== undefined && (
                <span
                  className={`inline-flex items-center gap-0.5 text-xs font-semibold mt-1 ${
                    mrrDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {mrrDelta >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  ) : (
                    <span className="shrink-0" aria-hidden>
                      ↓
                    </span>
                  )}
                  <span>
                    {Number(Math.abs(mrrDelta)).toLocaleString('en-US')}% {ta('mrr_delta')}
                  </span>
                </span>
              )}
            </div>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-100/80 dark:border-teal-800/40"
              aria-hidden
            >
              <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] p-4 card-shadow btn-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-medium">{ta('collection_rate')}</span>
              <span className="block text-xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {Number(d.collection_rate ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
              </span>
            </div>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100/80 dark:border-blue-800/40"
              aria-hidden
            >
              <Percent className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] p-4 card-shadow btn-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-medium">{ta('avg_per_student')}</span>
              <span className="block text-xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {Number(d.avg_payment_per_student ?? 0).toLocaleString('en-US')}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ms-1">{egp}</span>
              </span>
            </div>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-50 dark:bg-purple-900/30 border border-purple-100/80 dark:border-purple-800/40"
              aria-hidden
            >
              <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--color-surface-1)] p-4 card-shadow btn-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-medium">{ta('total_revenue')}</span>
              <span className="block text-xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {Number(totalRevenue).toLocaleString('en-US')}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ms-1">{egp}</span>
              </span>
            </div>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-100/80 dark:border-amber-800/40"
              aria-hidden
            >
              <Wallet className="w-5 h-5 text-amber-600 dark:text-amber-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-4 mb-4 chart-animate chart-animate-delay-1">
        <ChartCard
          title={tCharts('monthlyRevenue')}
          valuePrefix="EGP "
          value={Number(d.mrr ?? 0)}
          trend={mrrDelta}
          trendLabel={tCharts('vsLastMonth')}
          loading={loading && !data}
          minHeight={260}
        >
          {revenueData.length >= 2 ? (
            <div className="min-w-0 w-full">
              <RevenueAreaChart data={revenueData} />
            </div>
          ) : revenueData.length === 1 ? (
            <div className="chq-skeleton h-48 w-full rounded-xl" aria-hidden />
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">{ta('no_data')}</p>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 mb-4">
        <div className="chart-animate chart-animate-delay-2">
          <ChartCard title={tCharts('paymentMethods')} loading={loading && !data} minHeight={280}>
            {donutData.length > 0 ? (
              <>
                <div className="min-w-0 w-full">
                  <PaymentDonutChart data={donutData} />
                </div>
                <ChartLegend
                  direction="vertical"
                  items={donutData.map((slice) => ({
                    color: slice.color ?? '#64748B',
                    label: slice.name,
                    value: Number(slice.value).toLocaleString('en-US'),
                    suffix: ` ${egp}`,
                  }))}
                />
              </>
            ) : (
              <p className="text-sm text-slate-400 py-8 text-center">{ta('no_data')}</p>
            )}
          </ChartCard>
        </div>
        <div className="card p-4 chart-animate chart-animate-delay-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{ta('attendance_heatmap')}</h2>
          {heatmapCells.length > 0 ? (
            <AttendanceHeatmap cells={heatmapCells} weekLabels={ta.raw('week_days') as string[]} />
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">{ta('no_data')}</p>
          )}
        </div>
      </div>

      <section className="px-4 mb-6">
        <ChartCard title={ta('revenueByGroup')} loading={loading && !data} minHeight={260}>
          {d.revenue_by_group.length >= 2 ? (
            <div className="min-w-0 w-full">
              <RevenueByGroup data={d.revenue_by_group} />
            </div>
          ) : d.revenue_by_group.length === 1 ? (
            <div className="chq-skeleton h-48 w-full rounded-xl" aria-hidden />
          ) : (
            <RevenueByGroup data={d.revenue_by_group} />
          )}
        </ChartCard>
      </section>

      <section className="px-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{ta('pnl')}</h2>
        <PnLCard
          incomeByMonth={d.income_by_month}
          expensesByMonth={d.expenses_by_month}
          pnlMonths={d.pnl_months}
          locale={locale}
        />
      </section>

      <section className="px-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{ta('agingReport')}</h2>
        <AgingReport data={d.aging_report} onRefresh={loadData} />
      </section>

      <AnalyticsAiChatWidget />
    </div>
  );
}
