'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, UserRound, X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/formatNumber';

type StudentRow = {
  enrollmentId: string;
  studentId: string;
  name: string | null;
  phone: string | null;
  status: string;
  groupId: string;
  groupName: string | null;
};

type StudentBilling = {
  outstanding: number;
  lastPaymentAt: string | null;
  transactions: {
    id: string;
    date: string;
    amount: number;
    groupId: string | null;
    groupName: string | null;
    status: string | null;
  }[];
};

type StudentEntry = {
  studentId: string;
  name: string | null;
  phone: string | null;
  hasPending: boolean;
  groups: { id: string; name: string | null }[];
};

/** "+201012345789" / "01012345789" -> "010•••••789" (mask all but edges). */
function maskPhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('20')) digits = `0${digits.slice(2)}`;
  if (digits.length < 7) return raw;
  return `${digits.slice(0, 3)}${'•'.repeat(digits.length - 6)}${digits.slice(-3)}`;
}

/**
 * All students across the teacher's private groups (PRIVATE zone). Self-fetches
 * /api/teacher/private/students; the page only mounts this when the gate is
 * open, so a 401 means the session dropped. One row per student (enrollment
 * rows are folded client-side) with group pills, outstanding balance, search,
 * a group filter, and a detail slide-over with payment history.
 */
export default function AllStudentsList() {
  const t = useTranslations('teacherPortal.pages');
  const tList = useTranslations('teacherPortal.studentsList');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [billing, setBilling] = useState<Record<string, StudentBilling>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);

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
      const data = (await res.json()) as {
        students: StudentRow[];
        billingByStudent?: Record<string, StudentBilling>;
      };
      setStudents(data.students ?? []);
      setBilling(data.billingByStudent ?? {});
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
        if (s.status === 'pending') existing.hasPending = true;
      } else {
        byStudent.set(s.studentId, {
          studentId: s.studentId,
          name: s.name,
          phone: s.phone,
          hasPending: s.status === 'pending',
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

  const openStudent = openStudentId
    ? (entries.find((e) => e.studentId === openStudentId) ?? null)
    : null;
  const openBilling = openStudentId ? (billing[openStudentId] ?? null) : null;

  if (loading && students === null) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
          />
        ))}
      </div>
    );
  }

  if (loadError || students === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{tPortal('errorBody')}</p>
        <button
          onClick={load}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {tPortal('retry')}
        </button>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <UserRound size={28} className="mx-auto mb-3 text-[var(--color-text-muted)]" aria-hidden />
        <h3 className="mb-2 font-bold text-[var(--color-text-primary)]">{t('studentsEmptyTitle')}</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('studentsEmptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search + group filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tList('searchPlaceholder')}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] py-2 pe-3 ps-9 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          aria-label={tList('groupFilterLabel')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">{tList('allGroups')}</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name ?? '-'}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
          {tList('noMatches')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((e) => {
            const outstanding = billing[e.studentId]?.outstanding ?? 0;
            return (
              <li key={e.studentId}>
                <button
                  type="button"
                  onClick={() => setOpenStudentId(e.studentId)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3 text-start transition-colors hover:border-[var(--color-teal)]/40"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
                      {e.name ?? '-'}
                      {e.groups.map((g) => (
                        <span
                          key={g.id}
                          className="rounded-full bg-[var(--color-teal)] px-2 py-0.5 text-[11px] font-semibold text-white"
                        >
                          {g.name ?? '-'}
                        </span>
                      ))}
                    </p>
                    {e.phone ? (
                      <p className="text-xs text-[var(--color-text-muted)]" dir="ltr">
                        {e.phone}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {outstanding > 0 && (
                      <span className="num text-sm font-semibold text-[var(--color-brass)]">
                        {formatCurrency(outstanding, locale)}
                      </span>
                    )}
                    {e.hasPending && (
                      <span className="rounded-full bg-[var(--color-warning)]/15 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-warning)]">
                        {t('statusPending')}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Detail slide-over (from the inline-start side) */}
      {openStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => setOpenStudentId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openStudent.name ?? tList('detailTitle')}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-y-0 start-0 flex w-full max-w-sm flex-col overflow-y-auto rounded-e-[var(--radius-card)] bg-[var(--color-surface-1)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {openStudent.name ?? '-'}
              </h2>
              <button
                type="button"
                onClick={() => setOpenStudentId(null)}
                aria-label={tList('close')}
                className="rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <X className="h-5 w-5 text-[var(--color-text-secondary)]" aria-hidden />
              </button>
            </div>

            <dl className="flex flex-col gap-3">
              <div>
                <dt className="text-xs font-semibold text-[var(--color-text-muted)]">
                  {tList('phoneLabel')}
                </dt>
                <dd className="text-sm text-[var(--color-text-primary)]" dir="ltr">
                  {maskPhone(openStudent.phone) ?? '-'}
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-semibold text-[var(--color-text-muted)]">
                  {tList('groupsLabel')}
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {openStudent.groups.map((g) => (
                    <Link
                      key={g.id}
                      href={`/teacher/groups/${g.id}`}
                      className="rounded-full bg-[var(--color-teal)] px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      {g.name ?? '-'}
                    </Link>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--color-text-muted)]">
                  {tList('outstandingLabel')}
                </dt>
                <dd
                  className={[
                    'num text-sm font-semibold',
                    (openBilling?.outstanding ?? 0) > 0
                      ? 'text-[var(--color-brass)]'
                      : 'text-[var(--color-text-primary)]',
                  ].join(' ')}
                >
                  {formatCurrency(openBilling?.outstanding ?? 0, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--color-text-muted)]">
                  {tList('lastPaymentLabel')}
                </dt>
                <dd className="text-sm text-[var(--color-text-primary)]">
                  {openBilling?.lastPaymentAt
                    ? formatDate(openBilling.lastPaymentAt, locale)
                    : tList('noPayments')}
                </dd>
              </div>
            </dl>

            <h3 className="mb-2 mt-5 text-sm font-semibold text-[var(--color-text-muted)]">
              {tList('paymentHistory')}
            </h3>
            {openBilling && openBilling.transactions.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {openBilling.transactions.map((txn) => (
                  <li
                    key={txn.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="num text-sm font-semibold text-[var(--color-text-primary)]">
                        {formatCurrency(txn.amount, locale)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatDate(txn.date, locale)}
                        {txn.groupName ? <span className="ms-1.5">{txn.groupName}</span> : null}
                      </p>
                    </div>
                    <span
                      className={[
                        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        txn.status === 'paid'
                          ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                          : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
                      ].join(' ')}
                    >
                      {txn.status === 'paid' ? t('statusPaid') : t('statusPendingBill')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">{tList('noTransactions')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
