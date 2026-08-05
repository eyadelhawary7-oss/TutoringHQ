'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Search, UserRound } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { formatNumber, formatPhoneIntlGrouped } from '@/lib/formatNumber';
import { initialsOf } from '@/lib/initials';

type StudentRow = {
  enrollmentId: string;
  studentId: string;
  name: string | null;
  phone: string | null;
  status: string;
  groupId: string;
  groupName: string | null;
};

type StudentEntry = {
  studentId: string;
  name: string | null;
  phone: string | null;
  groups: { id: string; name: string | null }[];
};

/**
 * Merged-Teacher-Students §01 — every student across the teacher's private
 * groups. Self-fetches /api/teacher/private/students; the page only mounts this
 * when the gate is open, so a 401 means the session dropped. One row per
 * student (enrollment rows are folded client-side) with group tags and their
 * contact number, kept left-to-right in both languages.
 *
 * Tapping a row pushes /teacher/students/<id> — §02 is a page, not a
 * slide-over, because the design reaches it from four places (this list, a
 * group roster, attendance, a session record).
 */
export default function AllStudentsList() {
  const t = useTranslations('teacherPortal.pages');
  const tList = useTranslations('teacherPortal.studentsList');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [overCap, setOverCap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');

  const RowChevron = locale === 'ar' ? ChevronLeft : ChevronRight;

  const load = useCallback(async () => {
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
      const res = await fetch('/api/teacher/private/students', {
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
      const data = (await res.json()) as { students: StudentRow[]; over_cap?: boolean };
      setStudents(data.students ?? []);
      setOverCap(data.over_cap === true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Fold enrollment rows into one entry per student (a student in two groups
  // arrives as two rows).
  const entries = useMemo<StudentEntry[]>(() => {
    const byStudent = new Map<string, StudentEntry>();
    for (const s of students ?? []) {
      const existing = byStudent.get(s.studentId);
      if (existing) {
        if (!existing.groups.some((g) => g.id === s.groupId)) {
          existing.groups.push({ id: s.groupId, name: s.groupName });
        }
      } else {
        byStudent.set(s.studentId, {
          studentId: s.studentId,
          name: s.name,
          phone: s.phone,
          groups: [{ id: s.groupId, name: s.groupName }],
        });
      }
    }
    return Array.from(byStudent.values());
  }, [students]);

  const groupOptions = useMemo(() => {
    const byId = new Map<string, string | null>();
    for (const s of students ?? []) {
      if (!byId.has(s.groupId)) byId.set(s.groupId, s.groupName);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [students]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (groupFilter !== 'all' && !e.groups.some((g) => g.id === groupFilter)) return false;
      if (!q) return true;
      return (
        (e.name ?? '').toLowerCase().includes(q) ||
        (e.phone ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || q)
      );
    });
  }, [entries, search, groupFilter]);

  const chipClass = (on: boolean) =>
    [
      'shrink-0 rounded-[var(--radius-pill)] px-4 py-2 text-xs font-semibold transition-colors',
      on
        ? 'border border-[var(--color-teal-deep)] bg-[var(--color-teal-deep)] text-white'
        : 'border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
    ].join(' ');

  if (loading && students === null) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[72px] animate-pulse rounded-[var(--radius-card)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)]"
          />
        ))}
      </div>
    );
  }

  if (loadError || students === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={load}
          className="rounded-[var(--radius-md)] bg-[var(--color-teal)] px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-[var(--color-teal-deep)]"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      /* §01 quiet variant · a teacher's roster fills from their groups' own
         enrolments, not from a button on this screen, so it gets the muted tile
         and no action rather than a call to work that does not exist here. */
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] py-4">
        <EmptyState
          icon={UserRound}
          title={t('studentsEmptyTitle')}
          description={t('studentsEmptyBody')}
          quiet
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Over-cap lock warning: the students page is the one surface a locked
          Standard teacher can still reach, so it carries the call to action.
          The design draws no banner here - kept because it is a plan-limit
          warning with no design replacement (flagged F4). */}
      {overCap && (
        <div
          role="alert"
          className="mb-2 rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-sand)] p-4 text-[13px] font-semibold text-[var(--color-brass)]"
        >
          {tList('overCapWarning')}
        </div>
      )}

      {/* .search - one row, icon inline-start, borderless input */}
      <div className="mb-2 mt-1 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3">
        <Search size={17} className="shrink-0 text-[var(--color-text-disabled)]" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tList('searchPlaceholder')}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
        />
      </div>

      {/* .filters - group filter as a segmented pill row. Kept scrollable: a
          teacher with eight groups needs to reach the eighth. */}
      <div
        role="tablist"
        aria-label={tList('groupFilterLabel')}
        className="mb-3 flex gap-2 overflow-x-auto"
      >
        <button
          type="button"
          role="tab"
          aria-selected={groupFilter === 'all'}
          onClick={() => setGroupFilter('all')}
          className={chipClass(groupFilter === 'all')}
        >
          {tList('allGroups')}
        </button>
        {groupOptions.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={groupFilter === g.id}
            onClick={() => setGroupFilter(g.id)}
            className={chipClass(groupFilter === g.id)}
          >
            {g.name ?? '-'}
          </button>
        ))}
      </div>

      {/* .cnt */}
      <p className="mx-1 mb-2 text-[11px] font-semibold text-[var(--color-text-muted)]">
        {tList('studentCount', { count: formatNumber(filtered.length, locale) })}
      </p>

      {filtered.length === 0 ? (
        /* §01 quiet variant · "your search matched nothing", distinct copy from
           the empty-roster state above per §01's "do not reuse the same copy". */
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] py-4">
          <EmptyState icon={Search} title={tList('noMatches')} quiet />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((e) => (
            <li key={e.studentId}>
              <Link
                href={`/teacher/students/${e.studentId}`}
                className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-surface-0)] bg-[var(--color-surface-1)] p-4 text-start transition-colors hover:border-[var(--color-mint-deep)]"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[15px] font-bold text-[var(--color-text-secondary)]"
                  aria-hidden
                >
                  {initialsOf(e.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
                    <span className="truncate">{e.name ?? '-'}</span>
                    {e.groups.map((g) => (
                      <span
                        key={g.id}
                        className="shrink-0 rounded-[var(--radius-xs)] bg-[var(--color-mint)] px-2 py-1 text-[11px] font-semibold text-[var(--color-teal-deep)]"
                      >
                        {g.name ?? '-'}
                      </span>
                    ))}
                    <RowChevron
                      size={12}
                      className="ms-1 shrink-0 text-[var(--color-text-disabled)]"
                      aria-hidden
                    />
                  </p>
                  {e.phone ? (
                    <p
                      className="mt-1 font-mono text-xs tabular-nums text-[var(--color-text-muted)]"
                      dir="ltr"
                    >
                      {formatPhoneIntlGrouped(e.phone)}
                    </p>
                  ) : null}
                </div>
                <RowChevron
                  size={18}
                  className="shrink-0 text-[var(--color-surface-4)]"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
