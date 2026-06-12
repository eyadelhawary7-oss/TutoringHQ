'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';

type UpdatedGroup = {
  id: string;
  name: string | null;
  fee_per_class: number;
  status: string | null;
};

/**
 * Edit-group modal (name + per-class fee) with an archive danger zone. A fee
 * change only affects classes billed after the save (finish_class_and_bill
 * reads the group's current fee), so a warning shows when students are
 * enrolled. Archive flips status to 'archived' (the only inactive value
 * student_groups_status_chk allows) after an in-modal confirmation.
 */
export default function EditGroupModal({
  group,
  enrolledCount,
  open,
  onClose,
  onSaved,
  onArchived,
}: {
  group: { id: string; name: string | null; fee_per_class: number };
  enrolledCount: number;
  open: boolean;
  onClose: () => void;
  onSaved: (group: UpdatedGroup) => void;
  onArchived: () => void;
}) {
  const t = useTranslations('teacherPortal.editGroup');

  const [name, setName] = useState(group.name ?? '');
  const [fee, setFee] = useState(String(group.fee_per_class || ''));
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-prefill whenever the modal opens for (possibly refreshed) group data.
  useEffect(() => {
    if (open) {
      setName(group.name ?? '');
      setFee(String(group.fee_per_class || ''));
      setConfirmingArchive(false);
      setError(null);
    }
  }, [open, group.name, group.fee_per_class]);

  if (!open) return null;

  const patchGroup = async (body: Record<string, unknown>) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    return fetch(`/api/teacher/private/groups/${group.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(await getCsrfHeaders(session.access_token)),
      },
      body: JSON.stringify(body),
    });
  };

  const handleSave = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('nameRequired'));
      return;
    }
    const feeNum = Number(fee);
    if (!Number.isFinite(feeNum) || feeNum <= 0) {
      setError(t('feeInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await patchGroup({ name: trimmed, fee_per_class: feeNum });
      if (!res) {
        setError(t('genericError'));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        group?: UpdatedGroup;
        code?: string;
      };
      if (res.ok && data.group) {
        onSaved(data.group);
        return;
      }
      if (data.code === 'invalid_name') setError(t('nameRequired'));
      else if (data.code === 'invalid_fee') setError(t('feeInvalid'));
      else setError(t('genericError'));
    } catch {
      setError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    setError(null);
    setArchiving(true);
    try {
      const res = await patchGroup({ status: 'archived' });
      if (res?.ok) {
        onArchived();
        return;
      }
      setError(t('genericError'));
    } catch {
      setError(t('genericError'));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
            aria-label={t('cancel')}
          >
            <X className="h-5 w-5 text-[var(--color-text-secondary)]" aria-hidden />
          </button>
        </div>

        {confirmingArchive ? (
          <div>
            <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
              {t('archiveConfirm', { group: group.name ?? '' })}
            </p>
            {error && (
              <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingArchive(false)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                {t('archiveConfirmNo')}
              </button>
              <button
                type="button"
                onClick={handleArchive}
                disabled={archiving}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {archiving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t('archiveConfirmYes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('nameLabel')}
              </label>
              <input
                type="text"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('feeLabel')}
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
              {enrolledCount > 0 && (
                <p className="mt-1.5 text-xs text-[var(--color-warning)]">{t('feeWarning')}</p>
              )}
            </div>

            {error && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? t('saving') : t('save')}
            </button>

            <div className="mt-1 border-t border-[var(--color-border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setConfirmingArchive(true)}
                className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)]"
              >
                <Archive size={14} aria-hidden />
                {t('archiveButton')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
