'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';

/**
 * Confirm dialog for cancelling a single occurrence of a recurring slot.
 * Creates a kind='cancelled' schedule exception; the student WhatsApp
 * notification behind it is a Phase 4 stub (server-side detail - the copy
 * here just promises the notification).
 */
export default function CancelClassDialog({
  open,
  groupId,
  scheduleId,
  exceptionDate, // YYYY-MM-DD
  onClose,
  onCancelled,
}: {
  open: boolean;
  groupId: string;
  scheduleId: string;
  exceptionDate: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const t = useTranslations('teacherPortal.schedule');
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleConfirm = async () => {
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
          kind: 'cancelled',
        }),
      });
      if (res.status === 201 || res.status === 409) {
        // 409 = already cancelled/rescheduled elsewhere; refetch shows truth.
        toast.success(t('cancelledToast'));
        onCancelled();
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
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
          {t('confirmCancelTitle')}
        </h2>
        <p className="mb-5 text-sm text-[var(--color-text-secondary)]">{t('confirmCancelBody')}</p>
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
            onClick={handleConfirm}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('confirmCancelAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
