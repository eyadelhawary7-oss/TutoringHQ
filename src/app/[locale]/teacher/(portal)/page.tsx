'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Banknote, Users, Sparkles, Clock, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatDate } from '@/lib/formatNumber';
import OnboardingChecklist from '../OnboardingChecklist';
import ReferralCard from '../ReferralCard';
import IncomeCalculator from '../IncomeCalculator';
import LockedIncomePreview from '../LockedIncomePreview';
import { useTeacherContext } from '../useTeacherContext';
import { useStartTrial } from '../useStartTrial';

const DAY_MS = 24 * 60 * 60 * 1000;

type Summary = {
  centersOutstanding: number;
  income: { collected: number; outstanding: number } | null;
  groups: { count: number; students: number } | null;
  sub:
    | { kind: 'trialing'; daysLeft: number }
    | { kind: 'active'; renewalAt: string | null }
    | { kind: 'none' };
};

function TileLink({
  href,
  icon: Icon,
  title,
  children,
}: {
  href: string;
  icon: typeof Building2;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-card transition-colors hover:border-[var(--color-teal)]/40"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
          <Icon size={16} aria-hidden />
          {title}
        </span>
        <ArrowRight size={14} className="text-[var(--color-text-muted)] rtl:-scale-x-100" aria-hidden />
      </div>
      {children}
    </Link>
  );
}

function TileCta({
  icon: Icon,
  title,
  body,
  ctaLabel,
  onCta,
}: {
  icon: typeof Building2;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-brass-soft)] p-5">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]">
        <Icon size={16} aria-hidden />
        {title}
      </span>
      <p className="mb-4 flex-1 text-sm text-[var(--color-text-secondary)]">{body}</p>
      <button
        type="button"
        onClick={onCta}
        className="self-start rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

export default function TeacherDashboardPage() {
  const t = useTranslations('teacherPortal.dashboard');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();

  const { ctx, loading, error, reload } = useTeacherContext();
  const [summary, setSummary] = useState<Summary | null>(null);

  const state = ctx?.state ?? 'center_only';
  const hasPrivateAccess = ctx?.hasPrivateAccess ?? false;
  const noCenters = (ctx?.centers.length ?? 0) === 0;

  const { startTrial, modal } = useStartTrial(state, () => {
    reload();
    setSummary(null);
  });

  // Second-phase summary fetch once the bootstrap context is known.
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const h = { Authorization: `Bearer ${session.access_token}` };
      const priv = ctx.hasPrivateAccess;
      const [cutsRes, subRes, incomeRes, groupsRes] = await Promise.all([
        fetch('/api/teacher/center-cuts', { headers: h }).catch(() => null),
        fetch('/api/teacher/subscription/status', { headers: h }).catch(() => null),
        priv ? fetch('/api/teacher/private/income', { headers: h }).catch(() => null) : null,
        priv ? fetch('/api/teacher/private/groups', { headers: h }).catch(() => null) : null,
      ]);
      if (cancelled) return;

      const cuts = cutsRes?.ok ? ((await cutsRes.json()) as { totalOutstanding?: number }) : null;
      const subJson = subRes?.ok
        ? ((await subRes.json()) as {
            status?: string | null;
            trial_ends_at?: string | null;
            current_period_end?: string | null;
            next_billing_at?: string | null;
          })
        : null;
      const income = incomeRes?.ok
        ? ((await incomeRes.json()) as { collectedThisMonth?: number; outstanding?: number })
        : null;
      const groupsData = groupsRes?.ok
        ? ((await groupsRes.json()) as {
            groups?: { status: string | null; activeStudents: number }[];
          })
        : null;

      let sub: Summary['sub'] = { kind: 'none' };
      if (subJson?.status === 'trialing' && subJson.trial_ends_at) {
        const daysLeft = Math.max(0, Math.ceil((Date.parse(subJson.trial_ends_at) - Date.now()) / DAY_MS));
        sub = { kind: 'trialing', daysLeft };
      } else if (subJson?.status === 'active') {
        sub = { kind: 'active', renewalAt: subJson.current_period_end ?? subJson.next_billing_at ?? null };
      }

      const groupList = groupsData?.groups ?? [];
      if (cancelled) return;
      setSummary({
        centersOutstanding: Number(cuts?.totalOutstanding) || 0,
        income: income ? { collected: Number(income.collectedThisMonth) || 0, outstanding: Number(income.outstanding) || 0 } : null,
        groups: priv
          ? {
              count: groupList.filter((g) => g.status !== 'archived').length,
              students: groupList.reduce((acc, g) => acc + (g.activeStudents || 0), 0),
            }
          : null,
        sub,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  if (loading && !ctx) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !ctx) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{tPortal('errorTitle')}</h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={reload}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  const placeholder = <span className="inline-block h-5 w-20 animate-pulse rounded bg-[var(--color-surface-2)]" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>

      {!hasPrivateAccess && <OnboardingChecklist />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Centers */}
        <TileLink href="/teacher/centers" icon={Building2} title={t('centersTile')}>
          {noCenters ? (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('centersEmpty')}</p>
              <span className="mt-1 text-sm font-semibold text-[var(--color-teal-deep)]">
                {t('joinCenterCta')}
              </span>
            </>
          ) : (
            <>
              <p className="num text-2xl font-bold text-[var(--color-teal-deep)]">
                {summary ? formatCurrency(summary.centersOutstanding, locale) : placeholder}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('centersPending')}</p>
            </>
          )}
        </TileLink>

        {/* Income (unlocked only; free-zone gets the locked preview below) */}
        {hasPrivateAccess && (
          <TileLink href="/teacher/income" icon={Banknote} title={t('incomeTile')}>
            {summary?.income ? (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="num text-2xl font-bold text-[var(--color-teal-deep)]">
                  {formatCurrency(summary.income.collected, locale)}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('outstanding')}{' '}
                  <span className="num font-semibold text-[var(--color-warning)]">
                    {formatCurrency(summary.income.outstanding, locale)}
                  </span>
                </span>
              </div>
            ) : (
              placeholder
            )}
          </TileLink>
        )}

        {/* Groups */}
        {hasPrivateAccess ? (
          <TileLink href="/teacher/groups" icon={Users} title={t('groupsTile')}>
            {summary?.groups ? (
              <>
                <p className="num text-2xl font-bold text-[var(--color-text-primary)]">
                  {t('groupsCount', { count: formatNumber(summary.groups.count, locale) })}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('studentsCount', { count: formatNumber(summary.groups.students, locale) })}
                </p>
              </>
            ) : (
              placeholder
            )}
          </TileLink>
        ) : (
          <TileCta
            icon={Users}
            title={t('groupsTile')}
            body={t('groupsCtaBody')}
            ctaLabel={t('createFirstGroup')}
            onCta={startTrial}
          />
        )}

        {/* Subscription */}
        {hasPrivateAccess ? (
          <TileLink href="/teacher/income" icon={Clock} title={t('subscriptionTile')}>
            {summary ? (
              summary.sub.kind === 'trialing' ? (
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  {t('trialDaysLeft', { days: formatNumber(summary.sub.daysLeft, locale) })}
                </p>
              ) : summary.sub.kind === 'active' ? (
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  {summary.sub.renewalAt
                    ? t('renewsOn', { date: formatDate(summary.sub.renewalAt, locale) })
                    : t('subscriptionActive')}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)]">{t('subscriptionActive')}</p>
              )
            ) : (
              placeholder
            )}
          </TileLink>
        ) : (
          <TileCta
            icon={Sparkles}
            title={t('subscriptionTile')}
            body={t('trialCtaBody')}
            ctaLabel={t('startTrialCta')}
            onCta={startTrial}
          />
        )}
      </div>

      {/* Free zone: locked income preview, income calculator, referral. */}
      {!hasPrivateAccess && (
        <>
          <LockedIncomePreview onStartTrial={startTrial} />
          <IncomeCalculator onStartTrial={startTrial} />
          <ReferralCard />
        </>
      )}

      {modal}
    </div>
  );
}
