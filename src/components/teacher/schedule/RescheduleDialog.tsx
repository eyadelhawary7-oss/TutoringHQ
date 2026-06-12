'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { cairoDateKey } from '@/lib/cairo/day';

/**
 * Reschedule a single occurrence: pick a new date (today or later), an
 * optional new time and an optional note. Creates a kind='rescheduled'
 * schedule exception.
 */
export default function RescheduleDialog({
  open,
  groupId,
  scheduleId,
  exceptionDate, // YYYY-MM-DD - the occurrence being moved
  defaultTime, // HH:MM - the slot's regular time, prefilled
  onClose,
  onRescheduled,
}: {
  open: boolean;
  groupId: string;
  scheduleId: string;
  exceptionDate: string;
  defaultTime: string;
  onClose: () => void;
  onRescheduled: () => void;
}) {
  const t = useTranslations('teacherPortal.schedule');
  const toast = useToast();

  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState(defaultTime);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const todayKey = cairoDateKey();

  const handleSubmit = async () => {
    if (!newDate) {
      setError(t('newDateRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError(t('genericError'));
        return;
      }
      const res = await fetch('/api/teacher/private/schedule/exceptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          group_id: groupId,
          schedule_id: scheduleId,
          exception_date: exceptionDate,
          kind: 'rescheduled',
          new_date: newDate,
          ...(newTime ? { new_time_start: newTime } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (res.status === 201) {
        toast.success(t('rescheduledToast'));
        onRescheduled();
        return;
      }
      if (res.status === 409) {
        setError(t('exceptionExistsError'));
        return;
      }
      setError(t('genericError'));
    } catch {
      setError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
          {t('rescheduleTitle')}
        </h2>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('newDate')}
          </label>
          <input
            type="date"
            value={newDate}
            min={todayKey}
            onChange={(e) => setNewDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('newTime')}
          </label>
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('note')}
          </label>
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {error && (
          <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            {t('confirmCancelBack')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('rescheduleSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}
