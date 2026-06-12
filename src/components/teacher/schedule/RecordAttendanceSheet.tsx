'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { useToast } from '@/hooks/useToast';
import SheetShell from './SheetShell';

type RosterStudent = {
  id: string;
  name: string | null;
};

/**
 * Record-and-bill sheet for one schedule-slot occurrence. Loads the group's
 * ACTIVE roster, the teacher ticks who attended (all unchecked by default -
 * billing is opt-in per student), then one submit creates the session, the
 * scans and the charges via POST /api/teacher/private/schedule/sessions.
 */
export default function RecordAttendanceSheet({
  open,
  groupId,
  groupName,
  scheduleId,
  sessionDate, // YYYY-MM-DD
  onClose,
  onRecorded,
}: {
  open: boolean;
  groupId: string;
  groupName: string | null;
  scheduleId: string;
  sessionDate: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const t = useTranslations('teacherPortal.schedule');
  const locale = useLocale();
  const toast = useToast();

  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSubmitError(null);
    setLoading(true);
    setLoadError(false);
    let stale = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setLoadError(true);
          return;
        }
        const res = await fetch(`/api/teacher/private/groups/${groupId}/roster`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setLoadError(true);
          return;
        }
        const data = (await res.json()) as {
          roster?: { status: string; student: { id: string; name: string | null } }[];
        };
        if (stale) return;
        setStudents(
          (data.roster ?? [])
            .filter((r) => r.status === 'active')
            .map((r) => ({ id: r.student.id, name: r.student.name })),
        );
      } catch {
        if (!stale) setLoadError(true);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, groupId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError(t('genericError'));
        return;
      }
      const res = await fetch('/api/teacher/private/schedule/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          group_id: groupId,
          schedule_id: scheduleId,
          session_date: sessionDate,
          attendee_ids: Array.from(selected),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session_id?: string;
        charges_created?: number;
        already_exists?: boolean;
        billing_error?: string;
        error?: string;
      };
      if (res.status === 207) {
        // Session + attendance committed, billing failed - the work is saved.
        toast.warning(t('billingErrorWarning'));
        onRecorded();
        return;
      }
      if (res.ok) {
        toast.success(
          data.already_exists ? t('alreadyRecordedToast') : t('recordedToast'),
        );
        onRecorded();
        return;
      }
      if (res.status === 409 && data.error === 'CLASS_CANCELLED') {
        setSubmitError(t('classCancelledError'));
        return;
      }
      setSubmitError(t('genericError'));
    } catch {
      setSubmitError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetShell
      open={open}
      title={t('recordSheetTitle', { group: groupName ?? '' })}
      subtitle={formatDate(sessionDate, locale, 'long')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={selected.size === 0 || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('submitRecord', { count: formatNumber(selected.size, locale, { integerOnly: true }) })}
        </button>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          ))}
        </div>
      ) : loadError ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {t('genericError')}
        </p>
      ) : students.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('emptyRoster')}</p>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setSelected(new Set(students.map((s) => s.id)))}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
            >
              {t('selectAll')}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {students.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-4 py-3">
                  <span className="font-medium text-[var(--color-text-primary)]">{s.name}</span>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="h-5 w-5 rounded border-[var(--color-border)] accent-teal-600"
                  />
                </label>
              </li>
            ))}
          </ul>
          {submitError && (
            <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
              {submitError}
            </p>
          )}
        </>
      )}
    </SheetShell>
  );
}
