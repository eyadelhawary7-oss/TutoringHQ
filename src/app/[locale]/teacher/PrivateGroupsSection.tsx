'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Archive, ChevronDown, Loader2, Plus, Users } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import UpgradeFlow from '@/components/teacher/UpgradeFlow';
import { fetchTeacherSubscription } from '@/components/teacher/teacherSubscriptionClient';
import { getTeacherPlan } from '@/lib/teacherPlans';
import { initialsOf } from '@/lib/initials';

const STANDARD_GROUP_LIMIT = 8;

type PrivateGroup = {
  id: string;
  name: string | null;
  fee_per_class: number;
  status: string | null;
  activeStudents: number;
  pendingStudents: number;
};

/**
 * Private group list (State B only - the GET route is gated by
 * requireTeacherPrivateAccess). `refreshKey` re-fetches after a create.
 * Archived groups live in a collapsed section at the bottom with a restore
 * action; only active groups get the add CTA.
 */
export default function PrivateGroupsSection({
  refreshKey,
  onAdd,
}: {
  refreshKey: number;
  onAdd: () => void;
}) {
  const t = useTranslations('teacherPortal.groups');
  const tPortal = useTranslations('teacherPortal');
  const tCaps = useTranslations('caps');
  const locale = useLocale();
  const router = useRouter();

  const [planKey, setPlanKey] = useState<string | null>(null);
  const [groups, setGroups] = useState<PrivateGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState(false);

  const loadGroups = useCallback(async () => {
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
      const res = await fetch('/api/teacher/private/groups', {
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
      const data = (await res.json()) as { groups: PrivateGroup[] };
      setGroups(data.groups);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups, refreshKey]);

  useEffect(() => {
    let active = true;
    fetchTeacherSubscription().then((s) => {
      if (active) setPlanKey(s?.plan_key ?? null);
    });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const unarchive = async (groupId: string) => {
    setRestoringId(groupId);
    setRestoreError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`/api/teacher/private/groups/${groupId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!res.ok) {
        setRestoreError(true);
        return;
      }
      await loadGroups();
    } catch {
      setRestoreError(true);
    } finally {
      setRestoringId(null);
    }
  };

  const active = (groups ?? []).filter((g) => g.status !== 'archived');
  const archived = (groups ?? []).filter((g) => g.status === 'archived');
  // Standard teachers cap at 8 active private groups; pro-or-above is uncapped.
  // At the cap the create button is replaced by a brass upgrade CTA.
  const atGroupCap =
    getTeacherPlan(planKey).rank === 1 && active.length >= STANDARD_GROUP_LIMIT;

  const groupRow = (g: PrivateGroup) => (
    <Link
      href={`/teacher/groups/${g.id}`}
      className="flex flex-1 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors hover:border-[var(--color-teal)]/40"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-mint)] text-sm font-semibold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {initialsOf(g.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-text-primary)]">{g.name}</p>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            {t('students', { count: formatNumber(g.activeStudents, locale) })}
            {g.pendingStudents > 0 && (
              <span className="ms-2 text-[var(--color-warning)]">
                {t('pending', { count: formatNumber(g.pendingStudents, locale) })}
              </span>
            )}
          </p>
        </div>
      </div>
      <span className="text-sm text-[var(--color-text-secondary)]">
        {t('feePerClass')}{' '}
        <span className="font-semibold text-[var(--color-text-primary)]">
          {formatCurrency(g.fee_per_class, locale)}
        </span>
      </span>
    </Link>
  );

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Users size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
          {t('title')}
        </h2>
        {atGroupCap ? (
          <UpgradeFlow label={tCaps('upgradePrompt')} variant="brass" />
        ) : (
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            <Plus size={16} aria-hidden />
            {t('add')}
          </button>
        )}
      </div>

      {loading && groups === null ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      ) : loadError || groups === null ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-center">
          <button
            onClick={loadGroups}
            className="text-sm font-medium text-[var(--color-teal-deep)] hover:text-[var(--color-teal-deep)]"
          >
            {tPortal('retry')}
          </button>
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            /* §01 · this section's "new private group" control sits in its own
               header, so the empty state does not repeat it — one action, never
               two of equal weight. */
            <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] py-4">
              <EmptyState icon={Users} title={t('empty')} quiet />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {active.map((g) => (
                <li key={g.id}>{groupRow(g)}</li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setArchivedOpen((v) => !v)}
                aria-expanded={archivedOpen}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
              >
                <Archive size={14} aria-hidden />
                {t('archivedTitle', { count: formatNumber(archived.length, locale) })}
                <ChevronDown
                  size={14}
                  className={archivedOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
                  aria-hidden
                />
              </button>

              {archivedOpen && (
                <>
                  {restoreError && (
                    <p className="mt-3 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
                      {t('restoreError')}
                    </p>
                  )}
                  <ul className="mt-3 flex flex-col gap-2">
                    {archived.map((g) => (
                      <li key={g.id} className="flex items-center gap-2 opacity-60">
                        {groupRow(g)}
                        <button
                          type="button"
                          onClick={() => unarchive(g.id)}
                          disabled={restoringId === g.id}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {restoringId === g.id && (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          )}
                          {t('unarchive')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
