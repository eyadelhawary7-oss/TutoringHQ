'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Lock,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserX,
  Wallet,
} from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/formatNumber';
import { BarChartComponent } from '@/components/charts/BarChartComponent';

// Mirrors the TeacherAnalytics payload from src/lib/teacherAnalytics.ts.
type GroupRevenue = { groupId: string; name: string | null; revenue: number };
type ProjectionGroup = {
  groupId: string;
  name: string | null;
  feePerClass: number;
  enrolled: number;
  scheduledSessions: number;
  estimate: number;
};
type GroupAttendance = {
  groupId: string;
  name: string | null;
  finishedSessions: number;
  enrolled: number;
  rate: number | null;
};
type DayOfWeekAttendance = { jsWeekday: number; sessions: number; avgAttendance: number };
type NotSeenStudent = {
  studentId: string;
  name: string | null;
  lastSeen: string | null;
  daysSince: number | null;
};
type PaymentRiskStudent = {
  studentId: string;
  name: string | null;
  outstanding: number;
  unpaidCount: number;
};

type Analytics = {
  projection: { total: number; groups: ProjectionGroup[]; year: number; month: number };
  revenue: {
    byGroupThisMonth: GroupRevenue[];
    best: GroupRevenue | null;
    worst: GroupRevenue | null;
    trend: { year: number; month: number; revenue: number }[];
  };
  attendanceByGroup: GroupAttendance[];
  attendanceByDayOfWeek: {
    days: DayOfWeekAttendance[];
    highest: DayOfWeekAttendance | null;
    lowest: DayOfWeekAttendance | null;
  };
  notSeen: NotSeenStudent[];
  notSeenThresholdDays: number;
  paymentRisk: PaymentRiskStudent[];
  hasAnyActivity: boolean;
};

type ViewState = 'loading' | 'pro' | 'standard' | 'error';

/** Mid-month noon-UTC anchor: safely inside the Cairo month too. */
function monthAnchor(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}

/** Label for a JS weekday (0=Sun…6=Sat). 2023-01-01 is a Sunday in UTC. */
function weekdayLabel(jsWeekday: number, locale: string): string {
  return formatDate(new Date(Date.UTC(2023, 0, 1 + jsWeekday, 12, 0, 0)), locale, {
    weekday: 'long',
  });
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">{children}</h3>;
}

function Skeleton({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] ${className}`}
    />
  );
}

/**
 * Pro teacher analytics (Pile A). Fetches /api/teacher/private/analytics, which
 * is gated twice: requireTeacherPrivateAccess then requireTeacherPro. A 403
 * ANALYTICS_PRO_ONLY (Standard teacher) drops to the brass upgrade row,
 * mirroring the notes/guest Pro gate. Pile B trend cards always render an honest
 * "collecting data" state — we never show a misleading number from thin data.
 */
export default function AnalyticsView() {
  const t = useTranslations('teacherPortal.analytics');
  const locale = useLocale();
  const router = useRouter();

  const [state, setState] = useState<ViewState>('loading');
  const [data, setData] = useState<Analytics | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/private/analytics', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === 'ANALYTICS_PRO_ONLY') {
          setState('standard');
          return;
        }
        setState('error');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setData((await res.json()) as Analytics);
      setState('pro');
    } catch {
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <Card className="text-center">
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('error')}</p>
        <button
          onClick={load}
          className="text-sm font-medium text-[var(--color-teal-deep)] hover:underline"
        >
          {t('retry')}
        </button>
      </Card>
    );
  }

  if (state === 'standard') {
    // Brass upgrade row — mirrors the notes/guest Pro gate exactly.
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-5 py-4">
          <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Lock size={16} className="text-[var(--color-brass)]" aria-hidden />
            {t('proOnly')}
          </span>
          <Link
            href="/teacher/pricing"
            className="rounded-[14px] bg-[var(--color-brass)] px-4 py-2 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
          >
            {t('upgradeCta')}
          </Link>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">{t('proOnlyBody')}</p>
        <PileBPlaceholders />
      </div>
    );
  }

  if (!data) return null;

  const projectionMonth = formatDate(monthAnchor(data.projection.year, data.projection.month), locale, {
    month: 'long',
    year: 'numeric',
  });
  const groupName = (name: string | null) => name ?? t('unnamedGroup');
  const studentName = (name: string | null) => name ?? t('unnamedStudent');

  return (
    <div className="flex flex-col gap-8">
      {/* #1 Projection ----------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="money-hero rounded-[var(--radius-card)] p-5">
          <div className="mb-1 flex items-center gap-2 text-sm text-[#dfeeeb]">
            <CalendarClock size={16} aria-hidden />
            {t('projectionTitle')}
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              {t('estimateBadge')}
            </span>
          </div>
          <p className="num text-3xl font-bold">{formatCurrency(data.projection.total, locale)}</p>
          <p className="mt-1 text-xs text-[#dfeeeb]/80">
            {t('projectionForMonth', { month: projectionMonth })} · {t('projectionSubtitle')}
          </p>
        </div>
        {data.projection.groups.some((g) => g.estimate > 0) ? (
          <ul className="flex flex-col gap-2">
            {data.projection.groups
              .filter((g) => g.estimate > 0)
              .map((g) => (
                <li
                  key={g.groupId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--color-text-primary)]">
                      {groupName(g.name)}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t('projectionGroupLine', {
                        students: formatNumber(g.enrolled, locale),
                        fee: formatCurrency(g.feePerClass, locale),
                        sessions: formatNumber(g.scheduledSessions, locale),
                      })}
                    </span>
                  </span>
                  <span className="num text-sm font-semibold text-[var(--color-teal-deep)]">
                    {formatCurrency(g.estimate, locale)}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-center text-sm text-[var(--color-text-secondary)]">
            {t('projectionEmpty')}
          </p>
        )}
      </section>

      {/* #2 Best & weakest group ------------------------------------------ */}
      <section>
        <SectionHeading>{t('bestWorstTitle')}</SectionHeading>
        {data.revenue.best ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Trophy size={16} className="text-[var(--color-brass)]" aria-hidden />
                {t('bestGroup')}
              </div>
              <p className="truncate font-semibold text-[var(--color-text-primary)]">
                {groupName(data.revenue.best.name)}
              </p>
              <p className="num text-lg font-bold text-[var(--color-teal-deep)]">
                {formatCurrency(data.revenue.best.revenue, locale)}
              </p>
            </Card>
            {data.revenue.worst && data.revenue.worst.groupId !== data.revenue.best.groupId && (
              <Card>
                <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <TrendingDown size={16} className="text-[var(--color-warning)]" aria-hidden />
                  {t('worstGroup')}
                </div>
                <p className="truncate font-semibold text-[var(--color-text-primary)]">
                  {groupName(data.revenue.worst.name)}
                </p>
                <p className="num text-lg font-bold text-[var(--color-text-primary)]">
                  {formatCurrency(data.revenue.worst.revenue, locale)}
                </p>
              </Card>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-center text-sm text-[var(--color-text-secondary)]">
            {t('bestWorstEmpty')}
          </p>
        )}
      </section>

      {/* #3 Revenue by group + monthly trend ------------------------------ */}
      <RevenueSection
        byGroup={data.revenue.byGroupThisMonth}
        trend={data.revenue.trend}
        monthLabel={formatDate(
          monthAnchor(data.revenue.trend[data.revenue.trend.length - 1]?.year ?? data.projection.year, data.revenue.trend[data.revenue.trend.length - 1]?.month ?? 1),
          locale,
          { month: 'long', year: 'numeric' },
        )}
        groupName={groupName}
      />

      {/* #4 Attendance per group ------------------------------------------ */}
      <section>
        <SectionHeading>{t('attendanceTitle')}</SectionHeading>
        <p className="mb-3 -mt-2 text-xs text-[var(--color-text-muted)]">{t('attendanceSubtitle')}</p>
        {data.attendanceByGroup.length === 0 ? (
          <EmptyLine>{t('attendanceEmpty')}</EmptyLine>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.attendanceByGroup.map((g) => (
              <li
                key={g.groupId}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
                    {groupName(g.name)}
                  </span>
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {g.rate === null ? (
                      <span className="text-[var(--color-text-muted)]">{t('attendanceNoData')}</span>
                    ) : (
                      t('attendanceValue', { rate: formatPercent(g.rate * 100, locale) })
                    )}
                  </span>
                </div>
                {g.rate !== null && (
                  <>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-0)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-teal)]"
                        style={{ width: `${Math.round(g.rate * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {t('attendanceSessions', { count: formatNumber(g.finishedSessions, locale) })}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* #5 Attendance by day of week ------------------------------------- */}
      <section>
        <SectionHeading>{t('dowTitle')}</SectionHeading>
        {data.attendanceByDayOfWeek.days.length === 0 ? (
          <EmptyLine>{t('dowEmpty')}</EmptyLine>
        ) : (
          <Card>
            {data.attendanceByDayOfWeek.highest && data.attendanceByDayOfWeek.lowest && (
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 text-[var(--color-teal-deep)]">
                  <TrendingUp size={14} aria-hidden />
                  {t('dowBusiest', { day: weekdayLabel(data.attendanceByDayOfWeek.highest.jsWeekday, locale) })}
                </span>
                <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                  <TrendingDown size={14} aria-hidden />
                  {t('dowQuietest', { day: weekdayLabel(data.attendanceByDayOfWeek.lowest.jsWeekday, locale) })}
                </span>
              </div>
            )}
            <BarChartComponent
              data={data.attendanceByDayOfWeek.days.map((d) => ({
                day: weekdayLabel(d.jsWeekday, locale),
                attendance: d.avgAttendance,
              }))}
              dataKey="attendance"
              xKey="day"
              color="teal"
              height={180}
              integerYAxis
              tooltipValueFormatter={(v) => formatNumber(v, locale)}
            />
          </Card>
        )}
      </section>

      {/* #6 Students not seen in 3+ weeks --------------------------------- */}
      <section>
        <SectionHeading>{t('notSeenTitle', { days: formatNumber(data.notSeenThresholdDays, locale) })}</SectionHeading>
        <p className="mb-3 -mt-2 text-xs text-[var(--color-text-muted)]">{t('notSeenSubtitle')}</p>
        {data.notSeen.length === 0 ? (
          <EmptyLine>{t('notSeenEmpty')}</EmptyLine>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {data.notSeen.map((s) => (
              <li
                key={s.studentId}
                className="flex items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <UserX size={15} className="shrink-0 text-[var(--color-warning)]" aria-hidden />
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {studentName(s.name)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                  {s.lastSeen
                    ? t('notSeenLastSeen', { date: formatDate(s.lastSeen, locale, 'short') })
                    : t('notSeenNever')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* #7 Payment risk -------------------------------------------------- */}
      <section>
        <SectionHeading>{t('riskTitle')}</SectionHeading>
        <p className="mb-3 -mt-2 text-xs text-[var(--color-text-muted)]">{t('riskSubtitle')}</p>
        {data.paymentRisk.length === 0 ? (
          <EmptyLine>{t('riskEmpty')}</EmptyLine>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {data.paymentRisk.map((s) => (
              <li
                key={s.studentId}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0 text-[var(--color-warning)]" aria-hidden />
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {studentName(s.name)}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="num font-semibold text-[var(--color-warning)]">
                    {t('riskOutstanding', { amount: formatCurrency(s.outstanding, locale) })}
                  </span>
                  {s.unpaidCount > 0 && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t('riskUnpaidCount', { count: formatNumber(s.unpaidCount, locale) })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pile B — honest "collecting data" placeholders ------------------- */}
      <PileBPlaceholders />
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-center text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

function RevenueSection({
  byGroup,
  trend,
  monthLabel,
  groupName,
}: {
  byGroup: GroupRevenue[];
  trend: { year: number; month: number; revenue: number }[];
  monthLabel: string;
  groupName: (name: string | null) => string;
}) {
  const t = useTranslations('teacherPortal.analytics');
  const locale = useLocale();

  const hasRevenue =
    byGroup.some((g) => g.revenue > 0) || trend.some((m) => m.revenue > 0);
  const maxGroup = Math.max(1, ...byGroup.map((g) => g.revenue));

  const trendData = trend.map((m) => ({
    label: formatDate(monthAnchor(m.year, m.month), locale, { month: 'short' }),
    amount: m.revenue,
  }));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <SectionHeading>{t('revenueTrendTitle')}</SectionHeading>
        {!hasRevenue ? (
          <EmptyLine>{t('revenueEmpty')}</EmptyLine>
        ) : (
          <Card>
            {/* BarChartComponent renders its own empty-state when < 2 points. */}
            <BarChartComponent
              data={trendData}
              dataKey="amount"
              xKey="label"
              color="teal"
              height={180}
              currencyYAxis={{ locale }}
            />
          </Card>
        )}
      </div>

      {hasRevenue && byGroup.some((g) => g.revenue > 0) && (
        <div>
          <SectionHeading>{t('revenueByGroupTitle')}</SectionHeading>
          <p className="mb-3 -mt-2 text-xs text-[var(--color-text-muted)]">
            {t('revenueByGroupSubtitle', { month: monthLabel })}
          </p>
          <ul className="flex flex-col gap-2">
            {byGroup
              .filter((g) => g.revenue > 0)
              .map((g) => (
                <li
                  key={g.groupId}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
                      {groupName(g.name)}
                    </span>
                    <span className="num text-sm font-semibold text-[var(--color-teal-deep)]">
                      {formatCurrency(g.revenue, locale)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-0)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-brass)]"
                      style={{ width: `${Math.round((g.revenue / maxGroup) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Pile B trend metrics are NOT computed — they need more history than thin data
 * can honestly support. Each renders a labeled "collecting data" card instead of
 * a misleading number.
 */
function PileBPlaceholders() {
  const t = useTranslations('teacherPortal.analytics');
  const titles = ['dropoutTitle', 'trendingTitle', 'missingTitle'] as const;
  return (
    <section>
      <SectionHeading>{t('collectingTitle')}</SectionHeading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {titles.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-0)] p-5"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
              <CalendarDays size={15} className="text-[var(--color-text-muted)]" aria-hidden />
              {t(key)}
            </div>
            <span className="inline-flex w-fit items-center rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
              {t('collectingTitle')}
            </span>
            <p className="text-xs text-[var(--color-text-muted)]">{t('collectingBody')}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
