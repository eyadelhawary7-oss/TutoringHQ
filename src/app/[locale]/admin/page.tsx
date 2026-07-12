'use client';

import dynamic from 'next/dynamic';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { ChartCard } from '@/components/charts';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { KpiCard, SectionHeader } from '@/components/shared';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession } from '@/lib/adminAuth-client';
import { formatChartMonthLabel } from '@/lib/chartMonthLabel';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

const AreaChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.AreaChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const BarChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.BarChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);

interface OverviewData {
  totalCenters: number;
  activeCenters: number;
  pendingSignups: number;
  suspendedCenters?: number;
  totalStudents: number;
  totalMRR?: number;
  mrr?: number;
  signupsChart?: { date: string; count: number }[];
  monthlyRevenue?: { month: string; revenue: number }[];
  recentActivity?: Array<{ id?: string; action?: string; details?: unknown; created_at?: string }>;
  totalRevenueCollected?: number;
  revenueThisMonth?: number;
  pendingRevenue?: number;
}

/**
 * `?tab=` legacy URLs that map to dedicated admin sub-routes.
 * Permanent - bookmarked URLs must continue to work after the Phase 2 refactor.
 */
const ADMIN_TAB_REDIRECTS: Record<string, string> = {
  analytics: '/admin/analytics',
  billing: '/admin/billing',
  centers: '/admin/centers',
  cardOrders: '/admin/orders',
  cardorders: '/admin/orders',
  'card-orders': '/admin/orders',
  card_orders: '/admin/orders',
  ceo: '/ceo',
  ceoDashboard: '/ceo',
  ceodashboard: '/ceo',
  'ceo-dashboard': '/ceo',
  ceo_dashboard: '/ceo',
  finance: '/admin/finance',
  finances: '/admin/finance',
  health: '/admin/health',
  internalTeam: '/admin/internal-team',
  internalteam: '/admin/internal-team',
  'internal-team': '/admin/internal-team',
  internal_team: '/admin/internal-team',
  money: '/admin/finance',
  mrr: '/admin/finance',
  platformConfig: '/admin/platform-config',
  'platform-config': '/admin/platform-config',
  platformconfig: '/admin/platform-config',
  platform_config: '/admin/platform-config',
  /** platform health lives at /admin/health (no inline tab). */
  'platform-health': '/admin/health',
  platformhealth: '/admin/health',
  platform_health: '/admin/health',
  platformHealth: '/admin/health',
  planRequests: '/admin/plan-requests',
  'plan-requests': '/admin/plan-requests',
  planrequests: '/admin/plan-requests',
  plan_requests: '/admin/plan-requests',
  pricing: '/admin/pricing',
  'pricing-panel': '/admin/pricing',
  pricingpanel: '/admin/pricing',
  pricingPanel: '/admin/pricing',
  referral: '/admin/referrals',
  referrals: '/admin/referrals',
  renewal: '/admin/renewals',
  renewals: '/admin/renewals',
  revenue: '/admin/finance',
  vendor: '/admin/vendors',
  vendors: '/admin/vendors',
  withdrawal: '/admin/withdrawals',
  withdrawals: '/admin/withdrawals',
  whatsappPack: '/admin/whatsapp-pack',
  whatsapppack: '/admin/whatsapp-pack',
  'whatsapp-pack': '/admin/whatsapp-pack',
};

function resolveAdminTabRedirect(rawTab: string | null): string | undefined {
  if (!rawTab) return undefined;
  const trimmed = rawTab.trim();
  return ADMIN_TAB_REDIRECTS[trimmed] ?? ADMIN_TAB_REDIRECTS[trimmed.toLowerCase()];
}

function formatActivitySummary(
  action: string,
  details: unknown | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const d = details as Record<string, unknown> | undefined;
  if (action === 'center_create') return t('activityNewSignup');
  if (action === 'admin_invoice_approved') return t('activityPaymentProofApproved');
  if (action === 'admin_invoice_rejected') return t('activityPaymentProofRejected');
  if (action === 'payment_on_scan' && d?.method)
    return t('activityPaymentOnScan', { method: String(d.method) });
  if (action === 'admin_payment_recorded') return t('activityAdminPaymentRecorded');
  if (action === 'approve_signup') return t('activitySignupApproved');
  if (action === 'reject_signup') return t('activitySignupRejected');
  if (action === 'suspend_center') return t('activityCenterSuspended');
  if (action === 'reactivate_center') return t('activityCenterReactivated');
  return action?.replace(/_/g, ' ') ?? '';
}

function AdminOverviewPageContent() {
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tCharts = useTranslations('charts');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;
  const { setHideShell } = useLayout();

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Redirect legacy ?tab= URLs to their dedicated pages.
  useLayoutEffect(() => {
    if (!tabParam) return;
    const target = resolveAdminTabRedirect(tabParam);
    if (target) {
      router.replace(target as never, { scroll: false });
    }
  }, [tabParam, router]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  const loadOverview = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    const includeTestAgg = searchParams?.get('include_test') === '1';
    try {
      const res = await fetch(`/api/admin/overview${includeTestAgg ? '?include_test=1' : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(err?.error || tCommon('errorGeneric'));
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setLoadError(tAdmin('overviewInvalidResponse'));
        return;
      }
      setOverview(data as OverviewData);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    }
  }, [router, searchParams, tAdmin, tCommon]);

  useEffect(() => {
    if (resolveAdminTabRedirect(tabParam)) {
      // Will redirect; skip overview fetch.
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void loadOverview()
      .then(() => {
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadOverview, tabParam]);

  const signupsWeekly = useMemo(() => {
    const chart = overview?.signupsChart ?? [];
    if (chart.length === 0) return [];
    const byWeek: Record<number, number> = {};
    for (const { date, count } of chart) {
      if (!date) continue;
      const d = new Date(date);
      const weekStart = new Date(d);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const ts = weekStart.getTime();
      byWeek[ts] = (byWeek[ts] ?? 0) + count;
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, count], i) => ({ date: `W${i + 1}`, count }));
  }, [overview?.signupsChart]);

  const overviewSignupData = useMemo(() => {
    if (signupsWeekly.length > 0) return signupsWeekly;
    return overview?.signupsChart ?? [];
  }, [signupsWeekly, overview?.signupsChart]);

  const signupTrendPct = useMemo(() => {
    const d = overviewSignupData;
    if (d.length < 2) return undefined;
    const last = Number(d[d.length - 1]?.count ?? 0);
    const prev = Number(d[d.length - 2]?.count ?? 0);
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }, [overviewSignupData]);

  const monthlyRevTrendPct = useMemo(() => {
    const m = overview?.monthlyRevenue ?? [];
    if (m.length < 2) return undefined;
    const last = Number(m[m.length - 1]?.revenue ?? 0);
    const prev = Number(m[m.length - 2]?.revenue ?? 0);
    if (prev === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }, [overview?.monthlyRevenue]);

  const chartMonthAxisFormatter = useCallback(
    (v: string | number) => formatChartMonthLabel(String(v), locale),
    [locale],
  );

  const activityActionLabel = useMemo(
    () =>
      ({
        signup_rejected: tAdmin('signupRejected'),
        'Signup rejected': tAdmin('signupRejected'),
        reject_signup: tAdmin('signupRejected'),
        student_create: tAdmin('studentCreate'),
        'student create': tAdmin('studentCreate'),
        center_update: tAdmin('centerUpdate'),
        'center update': tAdmin('centerUpdate'),
      }) as Record<string, string>,
    [tAdmin],
  );

  // While a redirect is in flight, render nothing to avoid flashing the overview.
  if (resolveAdminTabRedirect(tabParam)) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-col lg:flex-row flex-1">
        <AdminSidebar activeTab="overview" />
        <div className="flex-1 min-w-0 p-4 md:p-6 overflow-auto lg:ms-56 flex flex-col">
          {loadError && !overview ? (
            <div className="flex-1 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-4 flex flex-wrap items-center gap-3 justify-between">
              <p className="text-sm font-medium">{loadError}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadOverview()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
                >
                  {tAdmin('retry')}
                </button>
              </div>
            </div>
          ) : null}

          {isLoading && !overview ? (
            <div className="flex-1 space-y-6 animate-pulse">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]"
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]"
                  />
                ))}
              </div>
              <div className="h-48 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]" />
            </div>
          ) : null}

          {!overview && !isLoading && (
            <div className="flex-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-8 text-center text-[var(--color-text-secondary)] text-sm">
              {tAdmin('overviewUnavailable')}
            </div>
          )}

          {overview && (
            <div className="flex-1 flex flex-col">
              <div className="mb-3">
                <SectionHeader title={tAdmin('platformHealth')} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  label={tAdmin('totalCenters')}
                  value={formatNumber(overview.totalCenters ?? 0, locale)}
                />
                <KpiCard
                  label={tAdmin('activeCenters')}
                  value={formatNumber(overview.activeCenters ?? 0, locale)}
                  tone="success"
                />
                <KpiCard
                  label={tAdmin('suspendedCenters')}
                  value={formatNumber(overview.suspendedCenters ?? 0, locale)}
                  tone={overview.suspendedCenters ? 'danger' : 'muted'}
                />
                <KpiCard
                  label={tAdmin('totalStudents')}
                  value={formatNumber(overview.totalStudents ?? 0, locale)}
                />
              </div>

              <div className="mb-3">
                <SectionHeader title={tAdmin('revenue')} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  label={tAdmin('mrr')}
                  value={formatCurrency(overview.totalMRR ?? overview.mrr ?? 0, locale)}
                  tone="success"
                />
                <KpiCard
                  label={tAdmin('outstandingInvoices')}
                  value={formatCurrency(overview.pendingRevenue ?? 0, locale)}
                  tone={overview.pendingRevenue ? 'danger' : 'muted'}
                />
                <KpiCard
                  label={tAdmin('collectedThisMonth')}
                  value={formatCurrency(overview.revenueThisMonth ?? 0, locale)}
                  tone="muted"
                />
                <KpiCard
                  label={tAdmin('collectionRate')}
                  value={`${formatNumber(
                    overview.totalRevenueCollected != null &&
                      overview.pendingRevenue != null &&
                      overview.totalRevenueCollected + overview.pendingRevenue > 0
                      ? Math.round(
                          (overview.totalRevenueCollected /
                            (overview.totalRevenueCollected + overview.pendingRevenue)) *
                            100,
                        )
                      : 0,
                    locale,
                  )}%`}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-6">
                {overviewSignupData.length > 0 && (
                  <ChartCard
                    title={tAdmin('newCentersPerWeek')}
                    value={Number(overviewSignupData[overviewSignupData.length - 1]?.count ?? 0)}
                    trend={signupTrendPct}
                    trendLabel={tCharts('vsLastWeek')}
                    minHeight={220}
                  >
                    <AreaChartComponent
                      data={overviewSignupData}
                      dataKey="count"
                      xKey="date"
                      height={200}
                      color="teal"
                      showGrid={false}
                      integerYAxis
                      dedupYAxisTicks
                      xTickFormatter={chartMonthAxisFormatter}
                      tooltipLabelFormatter={chartMonthAxisFormatter}
                    />
                  </ChartCard>
                )}
                {(overview.monthlyRevenue?.length ?? 0) > 0 && overview.monthlyRevenue && (
                  <ChartCard
                    title={tCharts('monthlyRevenue')}
                    value={formatCurrency(
                      Number(overview.monthlyRevenue[overview.monthlyRevenue.length - 1]?.revenue ?? 0),
                      locale,
                    )}
                    trend={monthlyRevTrendPct}
                    trendLabel={tCharts('vsLastMonth')}
                    minHeight={220}
                  >
                    <BarChartComponent
                      data={overview.monthlyRevenue}
                      dataKey="revenue"
                      xKey="month"
                      height={200}
                      color="teal"
                      showGrid
                      currencyYAxis={{ locale }}
                      dedupYAxisTicks
                      xTickFormatter={chartMonthAxisFormatter}
                      tooltipLabelFormatter={chartMonthAxisFormatter}
                    />
                  </ChartCard>
                )}
              </div>

              {(overview.recentActivity?.length ?? 0) > 0 && (
                <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6">
                  <h3 className="font-bold text-[var(--color-text-primary)] mb-3">{tAdmin('recentActivity')}</h3>
                  <div className="space-y-3">
                    {(overview.recentActivity ?? []).slice(0, 5).map((a, i) => (
                      <div
                        key={a.id || i}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <span className="text-sm text-[var(--color-text-primary)]">
                          {activityActionLabel[a.action ?? ''] ?? formatActivitySummary(a.action || '', a.details, tAdmin)}
                          {a.details && typeof (a.details as { center_name?: string }).center_name === 'string' ? (
                            <> {(a.details as { center_name: string }).center_name}</>
                          ) : null}
                        </span>
                        <span className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap ms-3">
                          {a.created_at ? formatDate(a.created_at, locale) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-[var(--color-surface-0)]">
          <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
        </div>
      }
    >
      <AdminOverviewPageContent />
    </Suspense>
  );
}
