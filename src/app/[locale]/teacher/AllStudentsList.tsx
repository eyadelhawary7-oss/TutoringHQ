'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

type StudentRow = {
  enrollmentId: string;
  studentId: string;
  name: string | null;
  phone: string | null;
  status: string;
  groupId: string;
  groupName: string | null;
};

/**
 * All students across the teacher's private groups (PRIVATE zone). Self-fetches
 * /api/teacher/private/students; the page only mounts this when the gate is
 * open, so a 401 means the session dropped.
 */
export default function AllStudentsList() {
  const t = useTranslations('teacherPortal.pages');
  const tPortal = useTranslations('teacherPortal');
  const router = useRouter();

  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
      const data = (await res.json()) as { students: StudentRow[] };
      setStudents(data.students ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

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
    <ul className="flex flex-col gap-2">
      {students.map((s) => (
        <li
          key={s.enrollmentId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3"
        >
          <div className="min-w-0">
            <p className="font-medium text-[var(--color-text-primary)]">{s.name ?? '-'}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {s.groupName ?? '-'}
              {s.phone ? (
                <span dir="ltr" className="ms-2">
                  {s.phone}
                </span>
              ) : null}
            </p>
          </div>
          <span
            className={[
              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
              s.status === 'pending'
                ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
                : 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]',
            ].join(' ')}
          >
            {s.status === 'pending' ? t('statusPending') : t('statusActive')}
          </span>
        </li>
      ))}
    </ul>
  );
}
