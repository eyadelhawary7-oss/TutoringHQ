'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, HandCoins, Loader2, Unlink } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatPercent } from '@/lib/formatNumber';
import CenterRequestsTracker from './CenterRequestsTracker';

type GroupCut = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
  snapTeacherPct: number | null;
};

type CenterCut = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
  groups: GroupCut[];
};

type CenterCutsData = {
  centers: CenterCut[];
  totalCollectedThisMonth: number;
  totalOutstanding: number;
};

/**
 * Center-cut tracker (FREE zone). Visible to EVERY teacher regardless of
 * subscription - fetches /api/teacher/center-cuts (requireTeacherAuth, no
 * private gate), independently of the private-engine income view.
 *
 * `Merged-Teacher-Setup` §02 draws this as ONE hero: the owed headline, the
 * "from N centers - settled monthly" caption, and a two-stat footer reading
 * This month / All time. The all-time figure is NOT fetched here - it is the
 * already-live `earnedAllTime` from /api/teacher/center-attendance, handed down
 * by the page so the design's single hero is assembled without a second query
 * or a second definition of the same number. When it has not arrived (or the
 * sibling fetch failed) the stat is NOT DRAWN. It is never defaulted to 0: a
 * zero here is indistinguishable from D16's real, dormant zero, and a made-up
 * one would be unnoticeable and permanent.
 */
export default function CenterCutsSection({
  canDetach = false,
  allTimeEarned = null,
}: {
  canDetach?: boolean;
  /** All-time center cut, from the sibling center-attendance fetch. Null = unknown, not zero. */
  allTimeEarned?: number | null;
}) {
  const t = useTranslations('teacherPortal.centerCuts');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [data, setData] = useState<CenterCutsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detachFor, setDetachFor] = useState<string | null>(null);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [detachError, setDetachError] = useState(false);

  const loadCuts = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/center-cuts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as CenterCutsData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadCuts();
  }, [loadCuts]);

  // Flip a center-attached group back to the teacher's own solo private group.
  // The teacher's own action - no center approval. Future-only: past records are
  // untouched. On success the group leaves this view (it is private again).
  const detach = async (groupId: string) => {
    if (detachingId) return;
    setDetachingId(groupId);
    setDetachError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/group-detach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ group_id: groupId }),
      });
      if (!res.ok) {
        setDetachError(true);
        return;
      }
      setDetachFor(null);
      loadCuts();
    } catch {
      setDetachError(true);
    } finally {
      setDetachingId(null);
    }
  };

  const header = (
    <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
      <Building2 size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
      {t('title')}
    </h2>
  );

  if (loading && !data) {
    return (
      <section>
        {header}
        <div className="mb-4 h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
        <div className="h-20 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </section>
    );
  }

  if (loadError || !data) {
    return (
      <section>
        {header}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
          <button
            onClick={loadCuts}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {tPortal('retry')}
          </button>
        </div>
      </section>
    );
  }

  if (data.centers.length === 0) {
    return (
      <section>
        {header}
        <CenterRequestsTracker />
        {/* §01 quiet variant · the join-a-center flow is the tracker directly
            above this, so the empty state does not offer a second route to it —
            §01's "one action, never two of equal weight". */}
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] py-4">
          <EmptyState
            icon={Building2}
            title={t('emptyTitle')}
            description={t('emptyBody')}
            quiet
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      {header}

      <CenterRequestsTracker />

      {/* Headline: what centers owe me (total outstanding), drawn as the
          design's money hero - the shared `.money-hero` surface (ADR 031), not
          a local gradient. */}
      <div className="money-hero mb-4 rounded-[var(--radius-card)] p-5">
        <div className="mb-1 flex items-center gap-2 text-sm text-[var(--color-teal-soft)]">
          <HandCoins size={16} aria-hidden />
          {t('totalOutstanding')}
        </div>
        <p className="num text-3xl font-bold">{formatCurrency(data.totalOutstanding, locale)}</p>
        <p className="mt-1 text-xs text-[var(--color-teal-soft)]/80">
          {t('fromCentersCaption', { count: data.centers.length })}
        </p>

        {/* The design's two-stat footer. "All time" appears only once the real
            figure is in hand - see the component note on never defaulting it. */}
        <div className="mt-3 flex gap-4 border-t border-white/15 pt-3">
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-teal-soft)]">
              {t('statThisMonth')}
            </p>
            <p className="num mt-1 text-sm font-bold">
              {formatCurrency(data.totalCollectedThisMonth, locale)}
            </p>
          </div>
          {allTimeEarned != null && (
            <div className="flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-teal-soft)]">
                {t('statAllTime')}
              </p>
              <p className="num mt-1 text-sm font-bold">{formatCurrency(allTimeEarned, locale)}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">{t('yourCenters')}</h3>
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          {data.centers.length === 1
            ? t('centersActiveCountOne', { count: 1 })
            : t('centersActiveCount', { count: data.centers.length })}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {data.centers.map((c) => (
          <li
            key={c.id}
            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 shadow-card"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold text-[var(--color-text-primary)]">{c.name ?? t('unknownCenter')}</p>
              <span className="num text-sm text-[var(--color-text-secondary)]">
                {t('owedShort')}{' '}
                <span className="font-semibold text-[var(--color-teal-deep)]">
                  {formatCurrency(c.outstanding, locale)}
                </span>
              </span>
            </div>
            <p className="num mb-3 text-sm text-[var(--color-text-muted)]">
              {t('collectedShort')} {formatCurrency(c.collectedThisMonth, locale)}
              {' · '}
              {c.groups.length === 1
                ? t('centerGroupsCountOne', { count: 1 })
                : t('centerGroupsCount', { count: c.groups.length })}
            </p>

            {c.groups.length > 0 && (
              <ul className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
                {c.groups.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-col gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {g.name}
                        {g.snapTeacherPct != null && (
                          <span className="num ms-2 text-xs text-[var(--color-text-muted)]">
                            {t('cutLabel', { pct: formatPercent(g.snapTeacherPct, locale) })}
                          </span>
                        )}
                      </span>
                      <span className="num text-sm text-[var(--color-text-secondary)]">
                        {formatCurrency(g.outstanding, locale)}
                      </span>
                    </div>
                    {canDetach && (
                      detachFor === g.id ? (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
                          <p className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
                            {t('detachConfirmTitle')}
                          </p>
                          <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                            {t('detachConfirmBody')}
                          </p>
                          {detachError && (
                            <p className="mb-2 text-xs text-[var(--color-danger)]" role="alert">
                              {t('detachError')}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={detachingId === g.id}
                              onClick={() => detach(g.id)}
                              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                            >
                              {detachingId === g.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                              {t('detachConfirmYes')}
                            </button>
                            <button
                              type="button"
                              disabled={detachingId === g.id}
                              onClick={() => {
                                setDetachFor(null);
                                setDetachError(false);
                              }}
                              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] disabled:opacity-50"
                            >
                              {t('detachCancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDetachFor(g.id);
                            setDetachError(false);
                          }}
                          className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:underline"
                        >
                          <Unlink size={13} aria-hidden />
                          {t('detachAction')}
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
