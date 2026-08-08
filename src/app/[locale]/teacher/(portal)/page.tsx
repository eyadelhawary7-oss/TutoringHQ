'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Banknote, Users, Sparkles, Clock, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber, formatDate } from '@/lib/formatNumber';
import OnboardingChecklist from '../OnboardingChecklist';
import FreeZoneBanner from '../FreeZoneBanner';
import ReferralCard from '../ReferralCard';
import IncomeCalculator from '../IncomeCalculator';
import LockedIncomePreview from '../LockedIncomePreview';
import { useTeacherContext } from '../useTeacherContext';
import { useStartTrial } from '../useStartTrial';
import { getTeacherPlan, isProOrAbove } from '@/lib/teacherPlans';
import { resolveTeacherPrivateView } from '@/lib/teacherPrivateView';
import CollectForYouCard from '@/components/verification/CollectForYouCard';
import VerificationBadge from '@/components/verification/VerificationBadge';
import { useVerificationState } from '@/hooks/useVerificationState';

const DAY_MS = 24 * 60 * 60 * 1000;

type Summary = {
  displayName: string | null;
  /**
   * null means "we could not read it", NOT "it is zero".
   *
   * This used to be `Number(cuts?.totalOutstanding) || 0`, so a failed or
   * non-OK `/api/teacher/center-cuts` rendered a confident **0 EGP** on the
   * Centers tile — a fabricated figure, and the one kind of wrong number
   * nobody questions afterwards. The income and groups tiles beside it already
   * carried null-on-failure and fell back to the skeleton; this one was the
   * odd one out.
   */
  centersOutstanding: number | null;
  /**
   * How many center_fee rows sit behind `centersOutstanding`. 0 means the
   * figure rests on nothing, so it is an absence rather than a measurement and
   * must not be rendered as money.
   * See the evidence block in `src/app/api/teacher/center-cuts/route.ts`.
   */
  centersLedgerRows: number;
  income: { collected: number; outstanding: number } | null;
  groups: { count: number; students: number } | null;
  sub: {
    status: string | null;
    planKey: string | null;
    priceGross: number;
    daysLeft: number | null;
    renewalAt: string | null;
  };
};

/** 05-11 morning, 12-16 afternoon, 17-04 evening (client-local time). */
function greetingKeyForHour(hour: number): 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  if (hour >= 5 && hour < 12) return 'greetingMorning';
  if (hour >= 12 && hour < 17) return 'greetingAfternoon';
  return 'greetingEvening';
}

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
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-amber)]">
        <Icon size={16} aria-hidden />
        {title}
      </span>
      <p className="mb-4 flex-1 text-sm text-[var(--color-text-secondary)]">{body}</p>
      {/* Design `.subbtn` — block, full width, centred, 8px radius. Same
          treatment as the subscribed tile's CTA so the tile does not change
          shape depending on which state renders it. */}
      <button
        type="button"
        onClick={onCta}
        className="block w-full rounded-lg bg-[var(--color-brass)] px-4 py-3 text-center text-xs font-semibold text-white transition-opacity hover:opacity-90"
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
  // `Merged-Teacher-Home` §01 draws two frames in one screen. Which one a
  // teacher sees is decided HERE, by the one state machine, and nowhere else.
  const { state: verification } = useVerificationState();

  const state = ctx?.state ?? 'center_only';
  const hasPrivateAccess = ctx?.hasPrivateAccess ?? false;
  const noCenters = (ctx?.centers.length ?? 0) === 0;
  // 'records' (full access), 'resubscribe' (lapsed → free tier + resubscribe
  // message on the private tiles), 'upsell' (never subscribed → free-zone trial
  // CTAs). A lapsed teacher drops fully to the free tier; the Centers tile / center
  // monitoring is always available.
  const view = resolveTeacherPrivateView({ hasPrivateAccess, state });

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
      const [cutsRes, subRes, profileRes, incomeRes, groupsRes] = await Promise.all([
        fetch('/api/teacher/center-cuts', { headers: h }).catch(() => null),
        fetch('/api/teacher/subscription/status', { headers: h }).catch(() => null),
        fetch('/api/teacher/profile', { headers: h }).catch(() => null),
        priv ? fetch('/api/teacher/private/income', { headers: h }).catch(() => null) : null,
        priv ? fetch('/api/teacher/private/groups', { headers: h }).catch(() => null) : null,
      ]);
      if (cancelled) return;

      const cuts = cutsRes?.ok
        ? ((await cutsRes.json()) as { totalOutstanding?: number; ledgerRows?: number })
        : null;
      // Read it once, and only accept a finite number. Anything else — the
      // request failed, the body was missing the field, the field was a string
      // that will not parse — stays null and the tile shows the skeleton it
      // already shows while loading.
      const centersOutstanding =
        cuts != null && Number.isFinite(Number(cuts.totalOutstanding))
          ? Number(cuts.totalOutstanding)
          : null;
      // Absent field from an older deploy is treated as 0 (unmeasured), which
      // withholds the figure. Failing towards "we cannot say" is the safe way
      // for this one to be wrong.
      const centersLedgerRows =
        cuts != null && Number.isFinite(Number(cuts.ledgerRows))
          ? Number(cuts.ledgerRows)
          : 0;
      const subJson = subRes?.ok
        ? ((await subRes.json()) as {
            status?: string | null;
            plan_key?: string | null;
            price_gross?: number;
            trial_ends_at?: string | null;
            current_period_end?: string | null;
            next_billing_at?: string | null;
          })
        : null;
      const profile = profileRes?.ok
        ? ((await profileRes.json()) as { displayName?: string | null })
        : null;
      const income = incomeRes?.ok
        ? ((await incomeRes.json()) as { collectedThisMonth?: number; outstanding?: number })
        : null;
      const groupsData = groupsRes?.ok
        ? ((await groupsRes.json()) as {
            groups?: { status: string | null; activeStudents: number }[];
          })
        : null;

      const sub: Summary['sub'] = {
        status: subJson?.status ?? null,
        planKey: subJson?.plan_key ?? null,
        priceGross: Number(subJson?.price_gross) || 0,
        daysLeft:
          subJson?.status === 'trialing' && subJson.trial_ends_at
            ? Math.max(0, Math.ceil((Date.parse(subJson.trial_ends_at) - Date.now()) / DAY_MS))
            : null,
        renewalAt:
          subJson?.status === 'active'
            ? (subJson.current_period_end ?? subJson.next_billing_at ?? null)
            : null,
      };

      const groupList = groupsData?.groups ?? [];
      if (cancelled) return;
      setSummary({
        displayName: profile?.displayName ?? null,
        centersOutstanding,
        centersLedgerRows,
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
      {!hasPrivateAccess && <FreeZoneBanner />}
      {summary === null ? (
        <div className="h-7 w-56 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {t(greetingKeyForHour(new Date().getHours()), {
              name: summary.displayName?.trim() || t('greetingFallbackName'),
            })}
          </h1>
          {/* The design's `.vchip` beside the greeting, drawn as "Verified" in
              every frame. It now says whatever is true. */}
          <VerificationBadge state={verification} />
        </div>
      )}

      {/* `Merged-Teacher-Home` §01 UNVERIFIED frame. The live teacher home had
          no verification surface at all — not a false badge, but silence, which
          left a teacher no way to learn that collection exists. The card is
          shown whenever collection is not genuinely on, with its CTA disabled
          and explained. The VERIFIED frame (balance card, Pending/Available,
          Thursday payouts, recent payouts) is `Merged-Teacher-Money` —
          PROTECTED, deliberately not built here. */}
      {!verification.isVerified && <CollectForYouCard state={verification} />}

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
          ) : summary === null || summary.centersOutstanding === null ? (
            // Loading, or the cuts read failed. Same treatment either way: the
            // skeleton the tile already shows while loading. A 0 off a failed
            // fetch is a fabrication, not a friendly default.
            placeholder
          ) : summary.centersLedgerRows === 0 ? (
            /* No center_fee row sits behind this teacher, so the sum is an
               absence, not a measurement — see the evidence block in
               `src/app/api/teacher/center-cuts/route.ts`. Show no figure and no
               settlement claim. "0 EGP" under a tile headed "What centers owe
               me" is itself a money statement ("they owe you nothing"), and it
               is one nothing in the system is able to make yet. The tile keeps
               its link through to /teacher/centers, which is real. */
            <>
              <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
                {t('centersNotTracked')}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t('centersNotTrackedHint')}
              </p>
            </>
          ) : (
            <>
              <p className="num text-2xl font-bold text-[var(--color-teal-deep)]">
                {formatCurrency(summary.centersOutstanding, locale)}
              </p>
              {/* Deliberately NOT the design's zero-state "All centers settled".
                  That copy is only true of a measured zero, and this branch is
                  the first one that could ever produce one — it has never run
                  against a live row. Shipping the affirmative now would be
                  writing the claim before the fact that backs it exists. The
                  neutral label describes the figure without asserting anything
                  beyond it. */}
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
                  {summary.groups.count === 1
                    ? t('groupsCountOne', { count: formatNumber(1, locale) })
                    : t('groupsCount', { count: formatNumber(summary.groups.count, locale) })}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('studentsCount', { count: formatNumber(summary.groups.students, locale) })}
                </p>
              </>
            ) : (
              placeholder
            )}
          </TileLink>
        ) : view === 'resubscribe' ? (
          <TileCta
            icon={Users}
            title={t('groupsTile')}
            body={t('resubscribeLockedBody')}
            ctaLabel={t('ctaResubscribe')}
            onCta={startTrial}
          />
        ) : (
          <TileCta
            icon={Users}
            title={t('groupsTile')}
            body={t('groupsCtaBody')}
            ctaLabel={t('createFirstGroup')}
            onCta={startTrial}
          />
        )}

        {/* Subscription. `Merged-Teacher-Home` draws this tile as `.card.sub`
            — brass surface, brass border, brass header ink — in all four §01
            frames it has (grep: 4 × `class="card sub"`, 4 × `class="subbtn"`,
            4 × §01 frames). Live only did that in the two `TileCta` states, so
            a subscribed teacher saw a different-looking tile from a trial or
            lapsed one. All four design frames happen to draw the TRIALING
            state, so the treatment for active/lapsed is carried across from
            them for internal consistency rather than copied from a frame —
            it is a surface, not a claim about any number. */}
        {hasPrivateAccess ? (
          <div className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-brass-soft)] p-5">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-amber)]">
              <Clock size={16} aria-hidden />
              {t('subscriptionTile')}
            </span>
            {summary ? (
              <>
                {summary.sub.status === 'trialing' ? (
                  <p className="text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                    {t('trialDaysLeft', { days: formatNumber(summary.sub.daysLeft ?? 0, locale) })}
                  </p>
                ) : summary.sub.status === 'active' ? (
                  <p className="text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                    {summary.sub.renewalAt
                      ? t('renewsOn', { date: formatDate(summary.sub.renewalAt, locale) })
                      : t('subscriptionActive')}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {summary.sub.status === 'past_due'
                      ? t('subPastDue')
                      : summary.sub.status === 'suspended'
                        ? t('subSuspended')
                        : summary.sub.status === 'cancelled'
                          ? t('subCancelled')
                          : t('subscriptionActive')}
                  </p>
                )}
                {summary.sub.status === 'active' && isProOrAbove(summary.sub.planKey) ? (
                  <span className="mt-2 self-start rounded-full bg-[var(--color-teal-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-teal-deep)]">
                    {t('proPlan')}
                  </span>
                ) : (
                  (() => {
                    const cta =
                      summary.sub.status === 'trialing'
                        ? {
                            label: t('ctaContinueTrial', {
                              price: formatCurrency(
                                summary.sub.priceGross ||
                                  getTeacherPlan(summary.sub.planKey).priceGross,
                                locale,
                              ),
                            }),
                            href: '/teacher/subscription/upgrade',
                          }
                        : summary.sub.status === 'active' &&
                            getTeacherPlan(summary.sub.planKey).rank === 1
                          ? { label: t('ctaUpgradePro'), href: '/teacher/subscription/upgrade' }
                          : summary.sub.status === 'past_due'
                            ? { label: t('ctaUpdatePayment'), href: '/teacher/resubscribe' }
                            : summary.sub.status === 'suspended'
                              ? { label: t('ctaReactivate'), href: '/teacher/resubscribe' }
                              : summary.sub.status === 'cancelled'
                                ? { label: t('ctaResubscribe'), href: '/teacher/resubscribe' }
                                : null;
                    return cta ? (
                      <Link
                        href={cta.href}
                        className="mt-3 block w-full rounded-lg bg-[var(--color-brass)] px-4 py-3 text-center text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        {cta.label}
                      </Link>
                    ) : null;
                  })()
                )}
              </>
            ) : (
              placeholder
            )}
          </div>
        ) : view === 'resubscribe' ? (
          <TileCta
            icon={Sparkles}
            title={t('subscriptionTile')}
            body={t('resubscribeLockedBody')}
            ctaLabel={t('ctaResubscribe')}
            onCta={startTrial}
          />
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

      {/* Free zone: a lapsed teacher takes a full drop to the free tier exactly
          like a never-subscribed teacher; only the private tiles above carry the
          resubscribe message. Her Centers tile / center monitoring stays normal. */}
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
