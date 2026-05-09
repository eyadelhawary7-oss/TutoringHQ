'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useLayout } from '@/contexts/LayoutContext';
import { AreaChartComponent } from '@/components/charts/AreaChart';
import { BarChartComponent } from '@/components/charts/BarChartComponent';
import { formatCurrency, formatDate, formatGrowth, formatNumber, formatPercent } from '@/lib/formatNumber';
import type {
  FinanceCohort,
  FinanceData,
  FinanceOutstandingInvoice,
  FinanceAtRiskCenter,
  FinanceRevenueSlice,
  FinancePlanCount,
} from '@/types/admin-finance';

const PLAN_LABEL_EN: Record<string, string> = {
  solo: 'Solo',
  nano: 'Nano',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top centers',
};

const PLAN_LABEL_AR: Record<string, string> = {
  solo: 'فردي',
  nano: 'نانو',
  starter: 'أساسي',
  pro: 'محترف',
  business: 'أعمال',
  enterprise: 'مؤسسات',
  top_centers: 'كبار السناتر',
};

export default function AdminFinanceClient({ initialData }: { initialData: FinanceData }) {
  const locale = useLocale();
  const searchParams = useSearchParams();
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();
  const { toast } = useToast();
  const [data, setData] = useState<FinanceData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date(initialData.generatedAt));

  useEffect(() => { setHideShell(true); return () => setHideShell(false); }, [setHideShell]);
  useEffect(() => { closeMainSidebar?.(); }, [closeMainSidebar]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const q = searchParams?.toString() ?? '';
      const res = await fetch(`/api/admin/finance${q ? `?${q}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const fresh = (await res.json()) as FinanceData;
        setData(fresh);
        setLastUpdated(new Date(fresh.generatedAt));
      } else {
        toast.error(isAr ? 'فشل تحديث البيانات' : 'Could not refresh finance data');
      }
    } catch {
      toast.error(isAr ? 'فشل تحديث البيانات' : 'Could not refresh finance data');
    } finally {
      setRefreshing(false);
    }
  }, [searchParams, isAr, toast]);

  const planLabels = isAr ? PLAN_LABEL_AR : PLAN_LABEL_EN;
  const mrrGrowthPair =
    data.mrrTrend.length >= 2
      ? {
          current: Number(data.mrrTrend[data.mrrTrend.length - 1]?.amount) || 0,
          prior: Number(data.mrrTrend[data.mrrTrend.length - 2]?.amount) || 0,
        }
      : null;
  const mrrGrowthLabel =
    mrrGrowthPair != null ? formatGrowth(mrrGrowthPair.current, mrrGrowthPair.prior, locale) : null;
  const mrrGrowthNegative =
    mrrGrowthPair != null && mrrGrowthPair.prior > 0 && mrrGrowthPair.current < mrrGrowthPair.prior;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/finance" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56 gap-6">

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-medium text-[var(--color-text-primary)]">
                {isAr ? 'المالية' : 'Finance'}
              </h1>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {isAr ? 'آخر تحديث' : 'Last updated'}{' '}
                {formatDate(lastUpdated, locale, 'time')}
              </p>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
            >
              {refreshing ? (isAr ? 'جارٍ التحديث' : 'Refreshing') : (isAr ? 'تحديث' : 'Refresh')}
            </button>
          </div>

          <SectionLabel>{isAr ? 'الأرقام الرئيسية' : 'North star'}</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label={isAr ? 'الإيراد الشهري المتكرر' : 'MRR'}
              primary={formatCurrency(data.northStar.totalMRR, locale)}
              delta={
                mrrGrowthLabel
                  ? `${mrrGrowthLabel} ${isAr ? 'مقارنة بالشهر الماضي' : 'vs last month'}`
                  : isAr
                    ? 'لا بيانات للمقارنة'
                    : 'no comparison'
              }
              tone={mrrGrowthLabel ? (mrrGrowthNegative ? 'danger' : 'success') : 'muted'}
            />
            <KpiCard
              label={isAr ? 'السناتر النشطة' : 'Active centers'}
              primary={formatNumber(data.northStar.activeCenters, locale)}
              delta={`+${formatNumber(data.northStar.newCentersThisMonth, locale)} ${isAr ? 'هذا الشهر' : 'this month'}`}
              tone="success"
            />
            <KpiCard
              label={isAr ? 'إيراد هذا الشهر' : 'This month'}
              primary={formatCurrency(data.northStar.thisMonthRevenue, locale)}
              delta={isAr ? 'كل أنواع الفواتير' : 'all invoice types'}
              tone="muted"
            />
            <KpiCard
              label={isAr ? 'فواتير معلقة' : 'Outstanding'}
              primary={formatCurrency(data.northStar.outstandingTotal, locale)}
              delta={`${formatNumber(data.northStar.outstandingCount, locale)} ${isAr ? 'فاتورة' : 'invoices'}`}
              tone="warning"
            />
          </div>

          <SectionLabel>{isAr ? 'وحدة الاقتصاد' : 'Unit economics'}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard
              label={isAr ? 'معدل الفقدان الشهري' : 'Monthly churn'}
              primary={formatPercent(data.unitEconomics.monthlyChurnRate, locale)}
              delta={isAr ? 'راقبه' : 'watch closely'}
              tone={data.unitEconomics.monthlyChurnRate > 5 ? 'danger' : 'success'}
            />
            <KpiCard
              label={isAr ? 'القيمة العمرية' : 'LTV'}
              primary={formatCurrency(data.unitEconomics.ltv, locale)}
              delta={isAr ? 'متوسط لكل سنتر' : 'avg per center'}
              tone="muted"
            />
            <KpiCard
              label={isAr ? 'وقت أول دفعة' : 'Time to first payment'}
              primary={data.unitEconomics.ttfpDays === null
                ? '–'
                : `${formatNumber(data.unitEconomics.ttfpDays, locale)} ${isAr ? 'يوم' : 'days'}`}
              delta={isAr ? 'الوسيط منذ التسجيل' : 'median, signup to paid'}
              tone="muted"
            />
          </div>

          <SectionLabel>{isAr ? 'الإيراد على مدار الأشهر' : 'MRR trend (last 6 months)'}</SectionLabel>
          <Card>
            <AreaChartComponent
              data={data.mrrTrend.map((p) => ({ date: p.month, amount: p.amount }))}
              dataKey="amount"
              xKey="date"
              color="teal"
              height={220}
              tooltipValueFormatter={(v) => formatCurrency(Number(v), locale)}
              currencyYAxis={{ locale }}
            />
          </Card>

          <SectionLabel>{isAr ? 'التفصيل' : 'Composition'}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card title={isAr ? 'الإيراد حسب المنتج' : 'Revenue by product'}>
              <RevenueByTypeBars slices={data.revenueByType} locale={locale} />
            </Card>
            <Card title={isAr ? 'توزيع الباقات' : 'Plan distribution'}>
              <PlanDistribution plans={data.planDistribution} labels={planLabels} locale={locale} />
            </Card>
          </div>

          <SectionLabel>{isAr ? 'الاحتفاظ حسب فوج التسجيل' : 'Cohort retention'}</SectionLabel>
          <Card>
            <CohortGrid cohorts={data.cohorts} isAr={isAr} locale={locale} />
          </Card>

          <SectionLabel>{isAr ? 'يحتاج انتباهك' : 'Needs attention'}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card title={isAr ? 'فواتير معلقة' : 'Outstanding invoices'}>
              <OutstandingList items={data.outstandingInvoices} locale={locale} isAr={isAr} />
            </Card>
            <Card title={isAr ? 'سناتر في خطر' : 'At-risk centers'}>
              <AtRiskList items={data.atRiskCenters} locale={locale} isAr={isAr} />
            </Card>
          </div>

          <SectionLabel>{isAr ? 'مسار الكروت' : 'Card pipeline'}</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label={isAr ? 'في انتظار المورد' : 'Pending vendor'} primary={formatNumber(data.cardPipeline.pendingVendor, locale)} tone="muted" />
            <KpiCard label={isAr ? 'في الطريق' : 'In transit'} primary={formatNumber(data.cardPipeline.inTransit, locale)} tone="muted" />
            <KpiCard label={isAr ? 'تم التسليم' : 'Delivered'} primary={formatNumber(data.cardPipeline.delivered, locale)} tone="success" />
            <KpiCard label={isAr ? 'فشل' : 'Failed'} primary={formatNumber(data.cardPipeline.failed, locale)} tone={data.cardPipeline.failed > 0 ? 'danger' : 'muted'} />
          </div>

        </main>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-[var(--color-text-muted)] mt-2 mb-0">
      {children}
    </p>
  );
}

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-4">
      {title ? <p className="text-sm font-medium mb-3 text-[var(--color-text-primary)]">{title}</p> : null}
      {children}
    </div>
  );
}

type KpiTone = 'muted' | 'success' | 'warning' | 'danger';

function KpiCard({
  label, primary, delta, tone = 'muted',
}: { label: string; primary: string; delta?: string; tone?: KpiTone }) {
  const toneColor =
    tone === 'success' ? 'text-emerald-500'
    : tone === 'warning' ? 'text-amber-500'
    : tone === 'danger' ? 'text-red-500'
    : 'text-[var(--color-text-muted)]';
  return (
    <div className="bg-[var(--color-surface-2)] rounded-lg p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="text-xl md:text-2xl font-medium mt-1 text-[var(--color-text-primary)] leading-tight">{primary}</p>
      {delta ? <p className={`text-[11px] mt-1 ${toneColor}`}>{delta}</p> : null}
    </div>
  );
}

function RevenueByTypeBars({ slices, locale }: { slices: FinanceRevenueSlice[]; locale: string }) {
  if (slices.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">No revenue this month yet.</p>;
  }
  const palette = ['#0F6E56', '#1D9E75', '#5DCAA5', '#9FE1CB', '#64748B', '#94A3B8'];
  return (
    <div className="flex flex-col gap-3">
      {slices.map((s, i) => (
        <div key={s.type}>
          <div className="flex justify-between text-xs mb-1">
            <span>{s.label}</span>
            <span className="text-[var(--color-text-muted)]">
              {formatCurrency(s.amount, locale)} · {formatPercent(s.pct, locale)}
            </span>
          </div>
          <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, s.pct)}%`, background: palette[i % palette.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanDistribution({
  plans, labels, locale,
}: { plans: FinancePlanCount[]; labels: Record<string, string>; locale: string }) {
  if (plans.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">No active centers yet.</p>;
  }
  const data = plans.map((p) => ({
    name: labels[p.plan] ?? p.plan,
    count: p.count,
  }));
  return (
    <BarChartComponent
      data={data}
      dataKey="count"
      xKey="name"
      color="teal"
      height={200}
      tooltipValueFormatter={(v) => `${formatNumber(Number(v), locale)}`}
      integerYAxis
      dedupYAxisTicks
    />
  );
}

function CohortGrid({
  cohorts, isAr, locale,
}: { cohorts: FinanceCohort[]; isAr: boolean; locale: string }) {
  if (cohorts.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">No cohorts yet.</p>;
  }
  const months = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          <tr className="text-[var(--color-text-muted)]">
            <th className="text-start font-normal p-1">{isAr ? 'الفوج' : 'Cohort'}</th>
            {months.map((m) => (
              <th key={m} className="font-normal">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohortMonth}>
              <td className="text-[var(--color-text-muted)] p-1 whitespace-nowrap">
                {formatCohortLabel(c.cohortMonth, isAr)} · {formatNumber(c.size, locale)}
              </td>
              {c.retention.map((r, idx) => (
                <td key={idx}>
                  <div
                    className="text-center rounded font-medium py-1.5 px-1"
                    style={{ background: cohortBg(r), color: cohortFg(r) }}
                  >
                    {r === null ? '·' : formatNumber(r, locale)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cohortBg(r: number | null): string {
  if (r === null) return 'var(--color-surface-2)';
  if (r >= 90) return '#97C459';
  if (r >= 70) return '#C0DD97';
  if (r >= 50) return '#EAF3DE';
  if (r >= 30) return '#FAC775';
  return '#F7C1C1';
}

function cohortFg(r: number | null): string {
  if (r === null) return 'var(--color-text-muted)';
  if (r >= 50) return '#173404';
  if (r >= 30) return '#412402';
  return '#501313';
}

function formatCohortLabel(yearMonth: string, isAr: boolean): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m - 1), 1));
  return date.toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
}

function OutstandingList({
  items, locale, isAr,
}: { items: FinanceOutstandingInvoice[]; locale: string; isAr: boolean }) {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">{isAr ? 'لا توجد فواتير معلقة' : 'No outstanding invoices.'}</p>;
  }
  return (
    <div className="flex flex-col">
      {items.map((inv) => (
        <div key={inv.invoiceId} className="flex justify-between items-center py-2 border-b border-[var(--color-border)] last:border-b-0 text-sm">
          <span className="truncate me-2">{inv.centerName}</span>
          <span className={inv.daysOverdue > 7 ? 'text-amber-500' : 'text-[var(--color-text-muted)]'}>
            {formatCurrency(inv.amount, locale)} · {formatNumber(inv.daysOverdue, locale)}{isAr ? 'ي' : 'd'}
          </span>
        </div>
      ))}
    </div>
  );
}

function AtRiskList({
  items, locale, isAr,
}: { items: FinanceAtRiskCenter[]; locale: string; isAr: boolean }) {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">{isAr ? 'لا يوجد سناتر في خطر' : 'No centers below health 40.'}</p>;
  }
  return (
    <div className="flex flex-col">
      {items.map((c) => (
        <div key={c.centerId} className="flex justify-between items-center py-2 border-b border-[var(--color-border)] last:border-b-0 text-sm">
          <span className="truncate me-2">{c.centerName}</span>
          <span className={c.healthScore < 30 ? 'text-red-500' : 'text-amber-500'}>
            {formatNumber(c.healthScore, locale)} · {c.reason}
          </span>
        </div>
      ))}
    </div>
  );
}
