'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useLayout } from '@/contexts/LayoutContext';
import { AdminSidebar } from '@/components/AdminSidebar';
import {
  Building2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  CreditCard,
  Gift,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { FinancialsResponse } from '@/types/financials';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DashboardData {
  totalActiveCenters: number;
  mrr: number;
  arr: number;
  netNew30d: number;
  monthlyChurnRate: number;
  collectionRate: number;
  referralRate: number;
  newYesterday: number;
  churned: number;
  atRisk: number;
  healthDistribution: { name: string; value: number; color: string }[];
  cohortTable: { month: string; total: number; [k: string]: number | string }[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function FinancialSkeletons() {
  return (
    <div className="space-y-6 mt-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-24 animate-pulse bg-slate-800 rounded-xl" />
        ))}
      </div>
      <div className="h-48 w-full animate-pulse bg-slate-800 rounded-xl" />
      <div className="h-72 w-full animate-pulse bg-slate-800 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-32 animate-pulse bg-slate-800 rounded-xl" />
        <div className="h-32 animate-pulse bg-slate-800 rounded-xl" />
      </div>
      <div className="h-16 w-full animate-pulse bg-slate-800 rounded-xl" />
      <div className="h-16 w-full animate-pulse bg-slate-800 rounded-xl" />
      <div className="h-32 w-full animate-pulse bg-slate-800 rounded-xl" />
    </div>
  );
}

function FinancialErrorCard({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('ceo');
  return (
    <div className="rounded-xl bg-slate-800 p-6 mt-10">
      <p className="text-red-400 text-sm mb-3">{t('financials.fetchError')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-[#0D9488] text-white px-4 py-2 text-sm font-medium"
      >
        {t('financials.retryButton')}
      </button>
    </div>
  );
}

type CeoFinancialsT = (key: string, values?: Record<string, string | number>) => string;

function CeoFinancialsBody({
  financials,
  tFinancials,
  calendarMonth,
}: {
  financials: FinancialsResponse;
  tFinancials: CeoFinancialsT;
  calendarMonth: number;
}) {
  const donutData = [
    { name: tFinancials('financials.subscriptions'), value: financials.currentMonth.subscriptionRevenue },
    { name: tFinancials('financials.cardOrders'), value: financials.currentMonth.cardOrderRevenue },
    { name: tFinancials('financials.whatsappPack'), value: financials.currentMonth.whatsappPackRevenue },
  ];
  const DONUT_COLORS = ['#0D9488', '#F59E0B', '#6366F1'] as const;
  const allZero = donutData.every((entry) => entry.value === 0);

  const g = financials.whatsappPack.growthVsLastMonth;

  return (
    <>
      <section className="mt-12 space-y-6 border-t border-slate-800 pt-10">
        <h2 className="text-lg font-semibold text-slate-100">{tFinancials('financials.sectionTitle')}</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 border-l-4 border-teal-500">
            <p className="text-xs text-slate-400">{tFinancials('financials.cardTotalTitle')}</p>
            <p className="text-xl font-mono font-bold text-slate-100 mt-1">
              {financials.currentMonth.totalRevenue.toLocaleString('en-US')} EGP
            </p>
            <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
              <p>
                {tFinancials('financials.cardTotalSubSubscriptions', {
                  amount: financials.currentMonth.subscriptionRevenue.toLocaleString('en-US'),
                })}
              </p>
              <p>
                {tFinancials('financials.cardTotalSubCards', {
                  amount: financials.currentMonth.cardOrderRevenue.toLocaleString('en-US'),
                })}
              </p>
              <p>
                {tFinancials('financials.cardTotalSubWa', {
                  amount: financials.currentMonth.whatsappPackRevenue.toLocaleString('en-US'),
                })}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{tFinancials('financials.cardGrossProfitTitle')}</p>
            <p
              className={`text-xl font-mono font-bold mt-1 ${
                financials.currentMonth.grossProfit >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {financials.currentMonth.grossProfit.toLocaleString('en-US')} EGP
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{tFinancials('financials.cardMarginTitle')}</p>
            <p className="text-xl font-mono font-bold text-[#F59E0B] mt-1">
              {financials.currentMonth.profitMargin.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">{tFinancials('financials.cardProjectedArrTitle')}</p>
            <p className="text-xl font-mono font-bold text-slate-300 mt-1">
              {financials.annualView.projectedARR.toLocaleString('en-US')} EGP
            </p>
            <p className="text-[11px] text-slate-500 mt-2">{tFinancials('financials.projectedARRNote')}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">{tFinancials('financials.donutTitle')}</h3>
          {allZero ? (
            <div className="flex h-[260px] items-center justify-center text-slate-500 text-sm">
              {tFinancials('financials.noDataYet')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={donutData} dataKey="value" cx="50%" cy="50%" outerRadius={80}>
                  {DONUT_COLORS.map((color, index) => (
                    <Cell key={index} fill={color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | string | undefined) =>
                    value == null ? '' : `${Number(value).toLocaleString('en-US')} EGP`
                  }
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">{tFinancials('financials.chart12MonthTitle')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={financials.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis
                tick={{ fill: '#94a3b8' }}
                tickFormatter={(value: number | string) => Number(value).toLocaleString('en-US')}
              />
              <Tooltip
                formatter={(value: number | string | undefined) =>
                  value == null ? '' : `${Number(value).toLocaleString('en-US')} EGP`
                }
              />
              <Legend />
              <Bar
                name={tFinancials('financials.subscriptions')}
                dataKey="subscriptionRevenue"
                stackId="revenue"
                fill="#0D9488"
                animationBegin={0}
                animationDuration={800}
              />
              <Bar
                name={tFinancials('financials.cardOrders')}
                dataKey="cardOrderRevenue"
                stackId="revenue"
                fill="#F59E0B"
                animationBegin={0}
                animationDuration={800}
              />
              <Bar
                name={tFinancials('financials.whatsappPack')}
                dataKey="whatsappPackRevenue"
                stackId="revenue"
                fill="#6366F1"
                animationBegin={0}
                animationDuration={800}
              />
              <Line
                name={tFinancials('financials.totalRevenue')}
                dataKey="totalRevenue"
                stroke="#FFFFFF"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">{tFinancials('financials.cardOrdersPanelTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelTotalCardsSold')}</p>
                <p className="font-mono text-slate-100">
                  {financials.cardOrders.totalCardsSold.toLocaleString('en-US')}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelRevenueAllTime')}</p>
                <p className="font-mono text-slate-100">
                  {financials.cardOrders.revenueAllTime.toLocaleString('en-US')} EGP
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelRevenueThisMonth')}</p>
                <p className="font-mono text-slate-100">
                  {financials.cardOrders.revenueThisMonth.toLocaleString('en-US')} EGP
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelAverageOrderValue')}</p>
                <p className="font-mono text-slate-100">
                  {financials.cardOrders.averageOrderValue.toLocaleString('en-US')} EGP
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-start content-start">
              <span className="rounded-full bg-amber-500/20 text-amber-400 text-xs px-3 py-1 font-medium">
                {tFinancials('financials.badgePending')}: {financials.cardOrders.pendingOrders.toLocaleString('en-US')}
              </span>
              <span className="rounded-full bg-teal-500/20 text-[#0D9488] text-xs px-3 py-1 font-medium">
                {tFinancials('financials.badgePaid')}: {financials.cardOrders.paidOrders.toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">{tFinancials('financials.whatsappPanelTitle')}</h3>
          <div className="flex flex-wrap gap-6 items-baseline text-sm">
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelActiveParents')}</p>
              <p className="font-mono text-slate-100">
                {financials.whatsappPack.activeParents.toLocaleString('en-US')}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelPackMrr')}</p>
              <p className="font-mono text-slate-100">
                {financials.whatsappPack.packMRR.toLocaleString('en-US')} EGP
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelGrowthVsLastMonth')}</p>
              {g > 0 ? (
                <p className="text-green-400 font-mono" aria-label={tFinancials('financials.growthUp')}>
                  ↑ {g.toFixed(1)}%
                </p>
              ) : g < 0 ? (
                <p className="text-red-400 font-mono" aria-label={tFinancials('financials.growthDown')}>
                  ↓ {Math.abs(g).toFixed(1)}%
                </p>
              ) : (
                <p className="text-slate-400 font-mono">{tFinancials('financials.growthNeutral')}</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h3 className="text-sm font-medium text-slate-200">{tFinancials('financials.annualPanelTitle')}</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelCurrentYearRevenue')}</p>
              <p className="font-mono text-slate-100">
                {financials.annualView.currentYearRevenue.toLocaleString('en-US')} EGP
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelProjectedArr')}</p>
              <p className="font-mono text-slate-100">
                {financials.annualView.projectedARR.toLocaleString('en-US')} EGP
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelBestMonth')}</p>
              <p className="font-mono text-slate-100">
                {financials.annualView.bestMonth ?? tFinancials('financials.noDataYet')}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelWorstMonth')}</p>
              <p className="font-mono text-slate-100">
                {financials.annualView.worstMonth ?? tFinancials('financials.noDataYet')}
              </p>
            </div>
          </div>
          {[6, 7, 8].includes(calendarMonth) && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
              {tFinancials('financials.summerDipWarning')}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h3 className="text-sm font-medium text-slate-200">{tFinancials('financials.profitCalculatorTitle')}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
            <span className="font-mono">
              {financials.currentMonth.totalRevenue.toLocaleString('en-US')} EGP
            </span>
            <span className="text-slate-500">{tFinancials('financials.formulaMinus')}</span>
            <div className="flex flex-col">
              <span className="font-mono">
                {financials.currentMonth.fixedCosts.toLocaleString('en-US')} EGP
              </span>
              <span className="text-[10px] text-slate-500">{tFinancials('financials.fixedCostsNote')}</span>
            </div>
            <span className="text-slate-500">{tFinancials('financials.formulaMinus')}</span>
            <div className="flex flex-col">
              <span className="font-mono">
                {financials.currentMonth.variableCosts.toLocaleString('en-US')} EGP
              </span>
              <span className="text-[10px] text-slate-500">{tFinancials('financials.variableCostsNote')}</span>
            </div>
            <span className="text-slate-500">{tFinancials('financials.formulaEquals')}</span>
            <div className="flex flex-col">
              <span className="font-mono text-slate-100">
                {tFinancials('financials.formulaGrossProfit')}:{' '}
                {financials.currentMonth.grossProfit.toLocaleString('en-US')} EGP
              </span>
            </div>
          </div>
          <div className="text-xs text-slate-500 flex flex-wrap gap-2">
            <span>{tFinancials('financials.formulaTotalRevenue')}</span>
            <span>·</span>
            <span>{tFinancials('financials.formulaFixedCosts')}</span>
            <span>·</span>
            <span>{tFinancials('financials.formulaVariableCosts')}</span>
          </div>
          {financials.currentMonth.grossProfit < 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
              {tFinancials('financials.profitNegativeWarning')}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default function CeoDashboardPage() {
  const t = useTranslations('ceoDashboard');
  const locale = useLocale();
  const { setHideShell } = useLayout();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ceo/dashboard', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tFinancials = useTranslations('ceo');

  const [financials, setFinancials] = useState<FinancialsResponse | null>(null);
  const [financialsLoading, setFinancialsLoading] = useState(true);
  const [financialsError, setFinancialsError] = useState(false);
  const [financialsRetry, setFinancialsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!data) {
      return () => controller.abort();
    }
    setFinancialsLoading(true);
    setFinancialsError(false);
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setFinancialsLoading(false);
        setFinancialsError(true);
        return;
      }
      try {
        const r = await fetch('/api/ceo/financials', {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!r.ok) throw new Error(r.statusText);
        const json = (await r.json()) as FinancialsResponse;
        setFinancials(json);
        setFinancialsLoading(false);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setFinancialsError(true);
        setFinancialsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [data, financialsRetry]);

  const retryFinancials = () => setFinancialsRetry((c) => c + 1);

  const isRTL = locale === 'ar';

  if (loading && !data) {
    return (
      <div className="flex min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </main>
      </div>
    );
  }

  const d = data ?? {
    totalActiveCenters: 0,
    mrr: 0,
    arr: 0,
    netNew30d: 0,
    monthlyChurnRate: 0,
    collectionRate: 0,
    referralRate: 0,
    newYesterday: 0,
    churned: 0,
    atRisk: 0,
    healthDistribution: [],
    cohortTable: [],
  };

  const metrics = [
    { label: t('totalActiveCenters'), value: fmt(d.totalActiveCenters), icon: Building2 },
    { label: t('mrr'), value: `EGP ${fmt(d.mrr)}`, icon: DollarSign },
    { label: t('arr'), value: `EGP ${fmt(d.arr)}`, icon: TrendingUp },
    { label: t('netNew30d'), value: d.netNew30d >= 0 ? `+${d.netNew30d}` : String(d.netNew30d), icon: Users },
    { label: t('monthlyChurnRate'), value: `${d.monthlyChurnRate.toFixed(1)}%`, icon: TrendingDown },
    { label: t('collectionRate'), value: `${d.collectionRate.toFixed(1)}%`, icon: CreditCard },
    { label: t('referralRate'), value: `${d.referralRate.toFixed(1)}%`, icon: Gift },
  ];

  const calendarMonth = new Date().getMonth() + 1;

  return (
    <div className="flex min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
      <main className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-slate-200 text-[var(--color-text-secondary)]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 mb-6">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm mb-1">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              <p className="text-xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('healthDistribution')}</h2>
            {d.healthDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={d.healthDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {d.healthDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => [v ?? 0, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[var(--color-text-secondary)] text-center py-8">{t('noHealthData')}</p>
            )}
          </div>

          <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('briefingPreview')}</h2>
            <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <p>{t('activeCenters')}: {d.totalActiveCenters}</p>
              <p>{t('mrr')}: EGP {fmt(d.mrr)}</p>
              <p>{t('newYesterday')}: {d.newYesterday}</p>
              <p>{t('churned')}: {d.churned}</p>
              <p className="flex items-center gap-1">
                {t('atRisk')}: {d.atRisk}
                {d.atRisk > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('cohortTable')}</h2>
          {d.cohortTable.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)]">
                    <th className="text-start py-2 font-medium text-[var(--color-text-primary)]">{t('signupMonth')}</th>
                    <th className="text-start py-2 font-medium text-[var(--color-text-primary)]">{t('total')}</th>
                    {[0, 1, 2, 3, 4, 5, 6].map((m) => (
                      <th key={m} className="text-center py-2 font-medium text-[var(--color-text-primary)]">
                        M{m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.cohortTable.slice(0, 12).map((row) => (
                    <tr key={row.month} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2">{row.month}</td>
                      <td className="py-2">{row.total}</td>
                      {[0, 1, 2, 3, 4, 5, 6].map((m) => (
                        <td key={m} className="text-center py-2">
                          {(row[`m${m}`] as number) ?? '—'}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[var(--color-text-secondary)] text-center py-8">{t('noCohortData')}</p>
          )}
        </section>

        {financialsLoading && <FinancialSkeletons />}

        {financialsError && <FinancialErrorCard onRetry={retryFinancials} />}

        {!financialsLoading && !financialsError && financials !== null && (
          <CeoFinancialsBody
            financials={financials}
            tFinancials={tFinancials}
            calendarMonth={calendarMonth}
          />
        )}
      </main>
    </div>
  );
}
