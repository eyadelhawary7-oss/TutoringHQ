'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useLayout } from '@/contexts/LayoutContext';
import { AdminHeader } from '@/components/admin/AdminHeader';
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
import type {
  CommandStripResponse,
  GrowthPanelResponse,
  HealthPanelResponse,
} from '@/types/founder-dash';
import FounderCommandStrip from './FounderCommandStrip';
import FounderGrowthPanel from './FounderGrowthPanel';
import CenterHealthPanel from './CenterHealthPanel';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { CHART_STYLE } from '@/components/charts/ChartTokens';

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

function nf(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(n: unknown): string {
  return nf(n).toLocaleString('en-US');
}

function FinancialSkeletons() {
  return (
    <div className="space-y-6 mt-10">
      <div className="grid grid-cols-1 gap-4 max-w-xl">
        <div className="h-24 skeleton rounded-xl" />
      </div>
      <div className="h-48 w-full skeleton rounded-xl" />
      <div className="h-72 w-full skeleton rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-32 skeleton rounded-xl" />
        <div className="h-32 skeleton rounded-xl" />
      </div>
      <div className="h-16 w-full skeleton rounded-xl" />
      <div className="h-16 w-full skeleton rounded-xl" />
      <div className="h-32 w-full skeleton rounded-xl" />
    </div>
  );
}

function FinancialErrorCard({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('ceo');
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] card-shadow p-6 mt-10">
      <p className="text-red-600 dark:text-red-400 text-sm mb-3">{t('financials.fetchError')}</p>
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

const DEFAULT_COMMAND_STRIP: CommandStripResponse = {
  stats: {
    pendingApprovals: 0,
    leadsNeedingReply: 0,
    overduePayments: 0,
    atRiskCenters: 0,
  },
  actionQueue: [],
  pendingCenters: [],
  breakeven: { target: 77, activePayingCenters: 0 },
};

const DEFAULT_GROWTH_PANEL: GrowthPanelResponse = {
  pipeline: {
    stages: [
      { stage: 'lead', count: 0 },
      { stage: 'demo', count: 0 },
      { stage: 'trial', count: 0 },
      { stage: 'closed', count: 0 },
      { stage: 'lost', count: 0 },
    ],
    totalActive: 0,
  },
  geography: [],
  referral: {
    totalReferrers: 0,
    totalReferrals: 0,
    converted: 0,
    conversionRate: 0,
    commissionsOwed: 0,
    commissionsPaid: 0,
  },
};

const DEFAULT_HEALTH_PANEL: HealthPanelResponse = {
  centers: [],
  summary: {
    healthy: 0,
    engaged: 0,
    atRisk: 0,
    critical: 0,
    noScore: 0,
  },
};

function CeoFinancialsBody({
  financials,
  tFinancials,
}: {
  financials: FinancialsResponse;
  tFinancials: CeoFinancialsT;
}) {
  const tCharts = useTranslations('charts');
  const tCommon = useTranslations('common');
  const g = nf(financials.whatsappPack?.growthVsLastMonth);
  const monthly = Array.isArray(financials.monthly) ? financials.monthly : [];

  return (
    <>
      <section className="mt-12 space-y-6 border-t border-[var(--color-border-subtle)] pt-10">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white">{tFinancials('financials.sectionTitle')}</h2>

        <div className="grid grid-cols-1 gap-4 max-w-xl">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] card-shadow p-4 border-s-4 border-teal-500">
            <p className="text-xs text-slate-500 dark:text-slate-400">{tFinancials('financials.cardTotalTitle')}</p>
            <p className="text-xl font-mono font-bold text-slate-800 dark:text-white mt-1">
              {nf(financials.currentMonth?.totalRevenue).toLocaleString('en-US')} {tCommon('egp')}
            </p>
            <div className="mt-2 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <p>
                {tFinancials('financials.cardTotalSubSubscriptions', {
                  amount: nf(financials.currentMonth?.subscriptionRevenue).toLocaleString('en-US'),
                })}
              </p>
              <p>
                {tFinancials('financials.cardTotalSubCards', {
                  amount: nf(financials.currentMonth?.cardOrderRevenue).toLocaleString('en-US'),
                })}
              </p>
              <p>
                {tFinancials('financials.cardTotalSubWa', {
                  amount: nf(financials.currentMonth?.whatsappPackRevenue).toLocaleString('en-US'),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] card-shadow p-4">
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-3">{tFinancials('financials.chart12MonthTitle')}</h3>
          {monthly.length >= 2 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={monthly}>
                <CartesianGrid strokeDasharray="4 4" stroke={CHART_STYLE.gridColor} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{
                    fontSize: 11,
                    fill: CHART_STYLE.tickColor,
                    fontFamily: CHART_STYLE.fontFamily,
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{
                    fontSize: 11,
                    fill: CHART_STYLE.tickColor,
                    fontFamily: CHART_STYLE.fontFamily,
                  }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number | string) =>
                    Number(value ?? 0).toLocaleString('en-US')
                  }
                />
                <Tooltip
                  cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }}
                  content={(props) => {
                    const pl = props.payload?.map((p) => ({
                      name: String(p.name ?? p.dataKey ?? ''),
                      value: Number(p.value ?? 0),
                      color: String(p.color ?? p.stroke ?? '#0D9488'),
                      dataKey: String(p.dataKey ?? ''),
                    }));
                    return (
                      <ChartTooltip
                        active={props.active}
                        payload={pl}
                        label={props.label}
                        prefix="EGP "
                      />
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#94A3B8', fontFamily: CHART_STYLE.fontFamily }}
                />
                <Bar
                  name={tFinancials('financials.subscriptions')}
                  dataKey="subscriptionRevenue"
                  stackId="revenue"
                  fill="#0D9488"
                  animationBegin={0}
                  animationDuration={CHART_STYLE.animDuration}
                  animationEasing={CHART_STYLE.animEasing}
                />
                <Bar
                  name={tFinancials('financials.cardOrders')}
                  dataKey="cardOrderRevenue"
                  stackId="revenue"
                  fill="#F59E0B"
                  animationBegin={0}
                  animationDuration={CHART_STYLE.animDuration}
                  animationEasing={CHART_STYLE.animEasing}
                />
                <Bar
                  name={tFinancials('financials.whatsappPack')}
                  dataKey="whatsappPackRevenue"
                  stackId="revenue"
                  fill="#6366F1"
                  animationBegin={0}
                  animationDuration={CHART_STYLE.animDuration}
                  animationEasing={CHART_STYLE.animEasing}
                />
                <Line
                  name={tFinancials('financials.totalRevenue')}
                  dataKey="totalRevenue"
                  stroke="var(--ceo-chart-total-line, #0f766e)"
                  strokeWidth={CHART_STYLE.strokeWidth}
                  dot={false}
                  activeDot={{ r: CHART_STYLE.dotActiveRadius, stroke: '#0F172A', strokeWidth: 2 }}
                  animationDuration={CHART_STYLE.animDuration}
                  animationEasing={CHART_STYLE.animEasing}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex flex-col items-center justify-center text-center px-4 py-16"
              style={{ color: '#334155', fontSize: 13, fontFamily: CHART_STYLE.fontFamily }}
            >
              <p>{tCharts('noData')}</p>
              <p className="mt-1 text-xs opacity-80 max-w-xs">{tCharts('noDataSub')}</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] card-shadow p-4">
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-3">{tFinancials('financials.cardOrdersPanelTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelTotalCardsSold')}</p>
                <p className="font-mono text-slate-800 dark:text-white">
                  {nf(financials.cardOrders?.totalCardsSold).toLocaleString('en-US')}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelRevenueAllTime')}</p>
                <p className="font-mono text-slate-800 dark:text-white">
                  {nf(financials.cardOrders?.revenueAllTime).toLocaleString('en-US')} EGP
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelRevenueThisMonth')}</p>
                <p className="font-mono text-slate-800 dark:text-white">
                  {nf(financials.cardOrders?.revenueThisMonth).toLocaleString('en-US')} EGP
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">{tFinancials('financials.labelAverageOrderValue')}</p>
                <p className="font-mono text-slate-800 dark:text-white">
                  {nf(financials.cardOrders?.averageOrderValue).toLocaleString('en-US')} EGP
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-start content-start">
              <span className="rounded-full bg-amber-500/20 text-amber-400 text-xs px-3 py-1 font-medium">
                {tFinancials('financials.badgePending')}:{' '}
                {nf(financials.cardOrders?.pendingOrders).toLocaleString('en-US')}
              </span>
              <span className="rounded-full bg-teal-500/20 text-[#0D9488] text-xs px-3 py-1 font-medium">
                {tFinancials('financials.badgePaid')}:{' '}
                {nf(financials.cardOrders?.paidOrders).toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] card-shadow p-4">
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-3">{tFinancials('financials.whatsappPanelTitle')}</h3>
          <div className="flex flex-wrap gap-6 items-baseline text-sm">
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelActiveParents')}</p>
              <p className="font-mono text-slate-800 dark:text-white">
                {nf(financials.whatsappPack?.activeParents).toLocaleString('en-US')}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">{tFinancials('financials.labelPackMrr')}</p>
              <p className="font-mono text-slate-800 dark:text-white">
                {nf(financials.whatsappPack?.packMRR).toLocaleString('en-US')} EGP
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
      </section>
    </>
  );
}

export default function CeoDashboardClient({
  from,
  to,
  rangeSelector,
}: {
  from: string;
  to: string;
  rangeSelector: ReactNode;
}) {
  const t = useTranslations('ceoDashboard');
  const locale = useLocale();
  const { setHideShell } = useLayout();
  const [data, setData] = useState<DashboardData | null>(null);
  const [commandStrip, setCommandStrip] = useState<CommandStripResponse>(DEFAULT_COMMAND_STRIP);
  const [growthPanel, setGrowthPanel] = useState<GrowthPanelResponse>(DEFAULT_GROWTH_PANEL);
  const [healthPanel, setHealthPanel] = useState<HealthPanelResponse>(DEFAULT_HEALTH_PANEL);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeQs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const fetchData = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const [res, resStrip, resGrowth, resHealth] = await Promise.all([
        fetch(`/api/ceo/dashboard?${rangeQs}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/ceo/command-strip', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/ceo/growth-panel', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/ceo/health-panel', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (resStrip.ok) {
        try {
          const stripJson = (await resStrip.json()) as CommandStripResponse;
          setCommandStrip(stripJson);
        } catch (parseErr) {
          console.error('command-strip response parse error', parseErr);
          setCommandStrip(DEFAULT_COMMAND_STRIP);
        }
      } else {
        console.error('command-strip fetch failed', resStrip.status);
        setCommandStrip(DEFAULT_COMMAND_STRIP);
      }
      if (resGrowth.ok) {
        try {
          const growthJson = (await resGrowth.json()) as GrowthPanelResponse;
          setGrowthPanel(growthJson);
        } catch (growthParseErr) {
          console.error('growth-panel response parse error', growthParseErr);
          setGrowthPanel(DEFAULT_GROWTH_PANEL);
        }
      } else {
        console.error('growth-panel fetch failed', resGrowth.status);
        setGrowthPanel(DEFAULT_GROWTH_PANEL);
      }
      if (resHealth.ok) {
        try {
          const healthJson = (await resHealth.json()) as HealthPanelResponse;
          setHealthPanel(healthJson);
        } catch (healthParseErr) {
          console.error('health-panel response parse error', healthParseErr);
          setHealthPanel(DEFAULT_HEALTH_PANEL);
        }
      } else {
        console.error('health-panel fetch failed', resHealth.status);
        setHealthPanel(DEFAULT_HEALTH_PANEL);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [rangeQs]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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
        const r = await fetch(`/api/ceo/financials?${rangeQs}`, {
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
  }, [data, financialsRetry, rangeQs]);

  const retryFinancials = () => setFinancialsRetry((c) => c + 1);

  const isRTL = locale === 'ar';

  if (loading && !data) {
    return (
      <>
        <AdminHeader />
        <div className="flex flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
          <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
          <main className="flex-1 flex items-center justify-center lg:ms-56">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </main>
        </div>
      </>
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
    {
      label: t('netNew30d'),
      value: nf(d.netNew30d) >= 0 ? `+${fmt(d.netNew30d)}` : String(nf(d.netNew30d)),
      icon: Users,
    },
    { label: t('monthlyChurnRate'), value: `${nf(d.monthlyChurnRate).toFixed(1)}%`, icon: TrendingDown },
    { label: t('collectionRate'), value: `${nf(d.collectionRate).toFixed(1)}%`, icon: CreditCard },
    { label: t('referralRate'), value: `${nf(d.referralRate).toFixed(1)}%`, icon: Gift },
  ];

  return (
    <>
      <AdminHeader />
      <div className="flex flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminSidebar activeTab="ceoDashboard" activeRoute="/ceo-dashboard" />
        <main className="flex-1 overflow-auto p-6 lg:ms-56 page-enter">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          <button
            type="button"
            onClick={() => void fetchData()}
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

        <FounderCommandStrip {...commandStrip} />

        <FounderGrowthPanel {...growthPanel} />

        <CenterHealthPanel {...healthPanel} />

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

        {rangeSelector}

        <section className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6 mb-8">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('briefingPreview')}</h2>
          <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
            <p>{t('activeCenters')}: {d.totalActiveCenters}</p>
            <p>{t('mrr')}: EGP {fmt(d.mrr)}</p>
            <p>{t('newYesterday')}: {d.newYesterday}</p>
            <p>{t('churned')}: {d.churned}</p>
            <p className="flex items-center gap-1">
              {t('atRisk')}: {fmt(d.atRisk)}
              {nf(d.atRisk) > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
            </p>
          </div>
        </section>

        {financialsLoading && <FinancialSkeletons />}

        {financialsError && <FinancialErrorCard onRetry={retryFinancials} />}

        {!financialsLoading && !financialsError && financials !== null && (
          <CeoFinancialsBody financials={financials} tFinancials={tFinancials} />
        )}

        <section className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('cohortTable')}</h2>
          {Array.isArray(d.cohortTable) && d.cohortTable.length > 0 ? (
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
                          {nf(row[`m${m}`])}%
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
        </main>
      </div>
    </>
  );
}
