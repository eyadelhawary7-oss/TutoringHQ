'use client';

import { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, GraduationCap, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { ListSkeleton } from '@/components/patterns';
import { EmptyState } from '@/components/shared';

type MonitorGroup = {
  id: string;
  name: string | null;
  subject: string | null;
  studentCount: number;
  feePerClass: number | null;
  centerCutEgp: number;
};

type MonitorTeacher = {
  id: string;
  name: string | null;
  subject: string | null;
  groups: MonitorGroup[];
  money: {
    feesCollected: number;
    centerCutEarned: number;
    teacherEarnings: number;
    feesOutstanding: number;
  };
};

export type MyTeachersPanelHandle = { reload: () => void };

/** Real counts for §09's "5 teachers · 8 groups" header line. */
export type MyTeachersStats = { teachers: number; groups: number };

/**
 * VIEW-ONLY monitor: every teacher linked to this center, their center groups
 * here and the money to date (scoped to this center). No mutating actions live
 * here - requests are the only actions, and they live in their own panel.
 */
export default function MyTeachersPanel({
  panelRef,
  onStats,
}: {
  panelRef?: React.Ref<MyTeachersPanelHandle>;
  /** Reports the real teacher/group counts up to §09's header. */
  onStats?: (stats: MyTeachersStats) => void;
}) {
  const t = useTranslations('teachersSection');
  const locale = useLocale();

  const [teachers, setTeachers] = useState<MonitorTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/teacher-monitor', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const json = (await res.json()) as { teachers: MonitorTeacher[] };
      const list = json.teachers ?? [];
      setTeachers(list);
      onStats?.({
        teachers: list.length,
        groups: list.reduce((sum, tc) => sum + tc.groups.length, 0),
      });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [onStats]);

  useImperativeHandle(panelRef, () => ({ reload: load }), [load]);

  useEffect(() => {
    load();
  }, [load]);

  // §09 draws a loading skeleton frame of its own — the shared `ListSkeleton`
  // from `src/components/patterns/`, not a single grey bar.
  if (loading) {
    return <ListSkeleton rows={3} />;
  }
  if (loadError) {
    return (
      <p className="text-sm text-[var(--color-danger)]" role="alert">
        {t('monitorLoadError')}
      </p>
    );
  }
  // §09 draws an empty frame with a title, an explanation of the split, and the
  // invite CTA. Uses the shared `EmptyState` (Merged-Design-Patterns §01).
  if (teachers.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] card-shadow">
        <EmptyState
          icon={GraduationCap}
          title={t('monitorEmptyTitle')}
          description={t('monitorEmpty')}
          alt={t('monitorEmptyAlt')}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">{t('viewOnlyNote')}</p>
      <ul className="flex flex-col gap-3">
        {teachers.map((tc) => {
          const open = expandedId === tc.id;
          return (
            <li
              key={tc.id}
              className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4"
            >
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : tc.id)}
                className="flex w-full items-center justify-between gap-3 text-start"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-[var(--color-text-primary)]">
                    {tc.name ?? t('noValue')}
                  </span>
                  {tc.subject && (
                    <span className="block truncate text-xs text-[var(--color-text-muted)]">
                      {tc.subject}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                    <Users size={14} aria-hidden />
                    {formatNumber(tc.groups.length, locale)}
                  </span>
                  {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                </span>
              </button>

              {/* Money summary - always visible. */}
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Money label={t('feesCollected')} value={tc.money.feesCollected} locale={locale} />
                <Money label={t('centerCutEarned')} value={tc.money.centerCutEarned} locale={locale} />
                <Money label={t('teacherEarnings')} value={tc.money.teacherEarnings} locale={locale} />
                <Money label={t('feesOutstanding')} value={tc.money.feesOutstanding} locale={locale} muted />
              </div>

              {open && (
                <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {t('groupsHeading')}
                  </p>
                  {tc.groups.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">{t('monitorEmptyGroups')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {tc.groups.map((g) => (
                        <li
                          key={g.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                              {g.name ?? t('noValue')}
                            </span>
                            <span className="block truncate text-xs text-[var(--color-text-muted)]">
                              {g.subject ?? t('noValue')} · {t('students')}:{' '}
                              {formatNumber(g.studentCount, locale)}
                            </span>
                          </span>
                          <span className="shrink-0 text-end">
                            <span className="block font-mono text-xs text-[var(--color-text-primary)]">
                              {g.feePerClass != null ? formatCurrency(g.feePerClass, locale) : t('noValue')}{' '}
                              <span className="text-[var(--color-text-muted)]">/ {t('perLesson')}</span>
                            </span>
                            <span className="block font-mono text-xs text-[var(--color-text-muted)]">
                              {t('cut')}: {formatCurrency(g.centerCutEgp, locale)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Money({
  label,
  value,
  locale,
  muted,
}: {
  label: string;
  value: number;
  locale: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p
        className={`font-mono text-sm font-semibold ${muted ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'}`}
      >
        {formatCurrency(value, locale)}
      </p>
    </div>
  );
}
