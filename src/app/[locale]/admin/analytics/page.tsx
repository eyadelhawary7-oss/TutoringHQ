'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession } from '@/lib/adminAuth-client';
import { isAdminLastActiveStaleRaw } from '@/lib/adminUtils';
import { ChartCard, ChartLegend } from '@/components/charts';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { KpiCard, SectionHeader } from '@/components/shared';
import type { CenterRow } from '@/types/admin';

const BarChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.BarChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const DonutChart = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.DonutChart })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);

interface OverviewMrr {
  totalMRR?: number;
  mrr?: number;
}

export default function AdminAnalyticsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tCharts = useTranslations('charts');
  const tBilling = useTranslations('billing');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [overviewMrr, setOverviewMrr] = useState<OverviewMrr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ovRes = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (ovRes.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (ovRes.ok) {
        const ovData = await ovRes.json().catch(() => null);
        if (ovData && typeof ovData === 'object' && !Array.isArray(ovData)) {
          setOverviewMrr({
            totalMRR: (ovData as OverviewMrr).totalMRR,
            mrr: (ovData as OverviewMrr).mrr,
          });
        }
      }

      const all: CenterRow[] = [];
      let pageNum = 1;
      let hasNext = true;
      while (hasNext && pageNum <= 200) {
        const params = new URLSearchParams({ page: String(pageNum), limit: '100' });
        const res = await fetch(`/api/admin/centers?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) break;
        const data = (await res.json().catch(() => ({}))) as {
          centers?: unknown;
          pagination?: { has_next?: boolean };
        };
        const batch = (Array.isArray(data.centers) ? data.centers : []) as CenterRow[];
        all.push(...batch);
        hasNext = Boolean(data.pagination?.has_next);
        pageNum += 1;
      }
      setCenters(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [router, tCommon]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const planDonutData = useMemo(() => {
    const planIds = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const;
    const planColors = ['#64748B', '#94A3B8', '#6B7280', '#3B82F6', '#0D9488', '#7C3AED', '#F59E0B'] as const;
    const label: Record<(typeof planIds)[number], string> = {
      solo: tBilling('planNames.solo'),
      nano: tBilling('planNames.nano'),
      starter: tBilling('planNames.starter'),
      pro: tBilling('planNames.pro'),
      business: tBilling('planNames.business'),
      enterprise: tBilling('planNames.enterprise'),
      top_centers: tBilling('planNames.top_centers'),
    };
    return planIds.map((id, i) => ({
      name: label[id],
      value: centers.filter((c) => c.plan === id).length,
      color: planColors[i],
    }));
  }, [centers, tBilling]);

  const statusDonutData = useMemo(
    () => [
      {
        name: t('subActive'),
        value: centers.filter((c) => (c.status ?? 'active') === 'active').length,
        color: '#16A34A',
      },
      {
        name: t('subPending'),
        value: centers.filter((c) => c.status === 'pending').length,
        color: '#F59E0B',
      },
      {
        name: t('subSuspended'),
        value: centers.filter((c) => c.status === 'suspended').length,
        color: '#DC2626',
      },
    ],
    [centers, t],
  );

  const topStudentsBarData = useMemo(
    () =>
      [...centers]
        .sort((a, b) => (b.students_count ?? 0) - (a.students_count ?? 0))
        .slice(0, 5)
        .map((c) => ({ name: c.name, students_count: c.students_count ?? 0 })),
    [centers],
  );

  const topRevenueProxyBarData = useMemo(
    () =>
      [...centers]
        .filter((c) => (c.status ?? 'active') === 'active')
        .sort((a, b) => (b.students_count ?? 0) - (a.students_count ?? 0))
        .slice(0, 5)
        .map((c) => ({ name: c.name, students_count: c.students_count ?? 0 })),
    [centers],
  );

  const avgStudentsPerCenter = useMemo(() => {
    if (centers.length === 0) return 0;
    return Math.round(centers.reduce((s, c) => s + (c.students_count ?? 0), 0) / centers.length);
  }, [centers]);

  const avgRevenuePerCenterCell = useMemo(() => {
    const active = centers.filter((c) => (c.status ?? 'active') === 'active');
    if (active.length === 0) return formatCurrency(0, locale);
    const mrr = overviewMrr?.totalMRR ?? overviewMrr?.mrr ?? 0;
    return formatCurrency(Math.round(mrr / Math.max(1, active.length)), locale);
  }, [centers, locale, overviewMrr]);

  const zeroStudentsCount = useMemo(
    () => centers.filter((c) => (c.students_count ?? 0) === 0).length,
    [centers],
  );

  const atRiskCount = useMemo(
    () => centers.filter((c) => isAdminLastActiveStaleRaw(c.last_active)).length,
    [centers],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/analytics" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">{t('analytics')}</h1>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadData}
                className="px-3 py-1 rounded bg-red-600 text-white text-xs font-medium"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {loading && centers.length === 0 ? (
            <div className="space-y-4" aria-busy="true" aria-live="polite">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] chq-skeleton"
                  />
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="chq-skeleton h-72 rounded-xl" />
                <div className="chq-skeleton h-72 rounded-xl" />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3"><SectionHeader title={tCommon('sectionAtAGlance')} /></div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  label={t('analyticsAvgStudentsPerCenter')}
                  value={formatNumber(avgStudentsPerCenter, locale)}
                />
                <KpiCard
                  label={t('analyticsAvgRevenuePerCenter')}
                  value={avgRevenuePerCenterCell}
                  tone="success"
                />
                <KpiCard
                  label={t('analyticsCentersZeroStudents')}
                  value={formatNumber(zeroStudentsCount, locale)}
                  tone={zeroStudentsCount > 0 ? 'warning' : 'muted'}
                />
                <KpiCard
                  label={t('analyticsCentersAtRisk')}
                  value={formatNumber(atRiskCount, locale)}
                  tone={atRiskCount > 0 ? 'danger' : 'muted'}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <ChartCard title={tCharts('centersByPlan')} loading={loading} minHeight={300}>
                  <DonutChart
                    data={planDonutData}
                    height={200}
                    centerLabel={t('totalCenters')}
                    centerValue={centers.length}
                  />
                  <ChartLegend
                    direction="vertical"
                    items={planDonutData.map((d) => ({
                      color: d.color ?? '#64748B',
                      label: d.name,
                      value: d.value,
                    }))}
                  />
                </ChartCard>
                <ChartCard title={tCharts('centersByStatus')} loading={loading} minHeight={300}>
                  <DonutChart
                    data={statusDonutData}
                    height={200}
                    centerLabel={t('totalCenters')}
                    centerValue={centers.length}
                  />
                  <ChartLegend
                    direction="vertical"
                    items={statusDonutData.map((d) => ({
                      color: d.color ?? '#64748B',
                      label: d.name,
                      value: d.value,
                    }))}
                  />
                </ChartCard>
              </div>
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <ChartCard title={tCharts('topFiveByStudents')} loading={loading} minHeight={260}>
                  <BarChartComponent
                    data={topStudentsBarData}
                    layout="vertical"
                    categoryKey="name"
                    dataKey="students_count"
                    xKey="name"
                    height={200}
                    color="teal"
                    showGrid
                    rtl={isRTL}
                    integerYAxis
                    dedupYAxisTicks
                  />
                </ChartCard>
                <ChartCard
                  title={tCharts('topFiveByRevenue')}
                  subtitle={tCharts('estRevenueProxy')}
                  loading={loading}
                  minHeight={260}
                >
                  <BarChartComponent
                    data={topRevenueProxyBarData}
                    layout="vertical"
                    categoryKey="name"
                    dataKey="students_count"
                    xKey="name"
                    height={200}
                    color="blue"
                    showGrid
                    rtl={isRTL}
                    integerYAxis
                    dedupYAxisTicks
                  />
                </ChartCard>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
