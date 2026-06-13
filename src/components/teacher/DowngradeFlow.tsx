'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { teacherSubscriptionPost } from './teacherSubscriptionClient';

type GroupOption = { id: string; name: string | null; student_count: number };
type StudentOption = { id: string; name: string | null; group_name: string | null };

type DowngradeResponse = {
  downgraded?: boolean;
  needs_cap_resolution?: boolean;
  needs_student_resolution?: boolean;
  groups?: GroupOption[];
  students?: StudentOption[];
  group_count?: number;
  student_count?: number;
  group_limit?: number;
  student_limit?: number;
  error?: string;
};

type Step = 'confirm' | 'groups' | 'students' | 'success';

const GROUP_LIMIT = 8;
const STUDENT_LIMIT = 60;

/**
 * Pro -> Standard downgrade. A muted link opens a multi-step modal that walks
 * the teacher through shedding groups/students until they fit the Standard
 * caps, then calls the downgrade route. The route owns the lifecycle RPC; this
 * component only collects the teacher's choices.
 */
export default function DowngradeFlow({
  currentPeriodEnd,
  onDowngraded,
}: {
  currentPeriodEnd: string | null;
  onDowngraded?: () => void;
}) {
  const t = useTranslations('teacherBilling');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('confirm');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupCount, setGroupCount] = useState(0);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  const close = () => {
    setOpen(false);
    setStep('confirm');
    setError(null);
    setGroups([]);
    setStudents([]);
    setSelectedGroups(new Set());
    setSelectedStudents(new Set());
  };

  const applyResponse = (status: number, data: DowngradeResponse) => {
    if (status === 422) {
      setError(t('stillOverLimit'));
      return;
    }
    if (status < 200 || status >= 300) {
      setError(t('downgradeError'));
      return;
    }
    if (data.downgraded) {
      setStep('success');
      onDowngraded?.();
      return;
    }
    if (data.needs_cap_resolution) {
      setGroups(data.groups ?? []);
      setGroupCount(data.group_count ?? (data.groups ?? []).length);
      setSelectedGroups(new Set());
      setStep('groups');
      return;
    }
    if (data.needs_student_resolution) {
      setStudents(data.students ?? []);
      setStudentCount(data.student_count ?? (data.students ?? []).length);
      setSelectedStudents(new Set());
      setStep('students');
      return;
    }
    setError(t('downgradeError'));
  };

  const post = async (body?: unknown) => {
    setPending(true);
    setError(null);
    try {
      const res = await teacherSubscriptionPost('/api/teacher/subscription/downgrade', body);
      if (!res) {
        setError(t('downgradeError'));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as DowngradeResponse;
      applyResponse(res.status, data);
    } catch {
      setError(t('downgradeError'));
    } finally {
      setPending(false);
    }
  };

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const remainingGroups = groupCount - selectedGroups.size;
  const remainingStudents = studentCount - selectedStudents.size;
  const groupsOk = remainingGroups <= GROUP_LIMIT;
  const studentsOk = remainingStudents <= STUDENT_LIMIT;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-[var(--color-text-muted)] underline-offset-2 transition-colors hover:text-[var(--color-text-secondary)] hover:underline"
      >
        {t('downgradeCta')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {step === 'success'
                  ? t('downgradeSuccess')
                  : step === 'groups'
                    ? t('archiveGroupsTitle')
                    : step === 'students'
                      ? t('resolveStudentsTitle')
                      : t('downgradeConfirmTitle')}
              </h2>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
                aria-label={t('cancel')}
              >
                <X className="h-5 w-5 text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {step === 'confirm' && (
              <>
                <p className="mb-4 whitespace-pre-line text-sm text-[var(--color-text-secondary)]">
                  {t('downgradeConfirmBody', {
                    date: currentPeriodEnd ? formatDate(currentPeriodEnd, locale, 'long') : '',
                  })}
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    {t('back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => post()}
                    disabled={pending}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t('continue')}
                  </button>
                </div>
              </>
            )}

            {step === 'groups' && (
              <>
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  {t('archiveGroupsBody', { count: formatNumber(groupCount, locale) })}
                </p>
                <ul className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(g.id)}
                            onChange={() => setSelectedGroups((s) => toggle(s, g.id))}
                            className="h-4 w-4 accent-[var(--color-brass)]"
                          />
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">
                            {g.name}
                          </span>
                        </span>
                        <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
                          {t('studentsBadge', { count: formatNumber(g.student_count, locale) })}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">
                  {t('groupsRemaining', {
                    remaining: formatNumber(Math.max(0, remainingGroups), locale),
                    limit: formatNumber(GROUP_LIMIT, locale),
                  })}
                </p>
                {error && (
                  <p className="mb-3 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] px-3 py-2 text-sm text-[var(--color-danger)]">
                    {error}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => post({ groups_to_archive: Array.from(selectedGroups) })}
                    disabled={pending || !groupsOk}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t('continue')}
                  </button>
                </div>
              </>
            )}

            {step === 'students' && (
              <>
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  {t('resolveStudentsBody', { count: formatNumber(studentCount, locale) })}
                </p>
                <ul className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {students.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedStudents.has(s.id)}
                            onChange={() => setSelectedStudents((v) => toggle(v, s.id))}
                            className="h-4 w-4 accent-[var(--color-brass)]"
                          />
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">
                            {s.name}
                          </span>
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">{s.group_name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">
                  {t('studentsRemaining', {
                    remaining: formatNumber(Math.max(0, remainingStudents), locale),
                    limit: formatNumber(STUDENT_LIMIT, locale),
                  })}
                </p>
                {error && (
                  <p className="mb-3 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] px-3 py-2 text-sm text-[var(--color-danger)]">
                    {error}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => post({ students_to_unenroll: Array.from(selectedStudents) })}
                    disabled={pending || !studentsOk}
                    className="flex items-center gap-2 rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t('continue')}
                  </button>
                </div>
              </>
            )}

            {step === 'success' && (
              <>
                <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                  {t('downgradeSuccessBody')}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
                  >
                    {t('done')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
