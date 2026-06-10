'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type CreatedGroup = {
  id: string;
  name: string | null;
  fee_per_class: number;
  status: string | null;
  activeStudents: number;
  pendingStudents: number;
};

/**
 * Create-a-private-group modal (mirrors the center groups page's modal
 * pattern). When `showTrialTerms` is set (State A teacher, no subscription
 * row yet) the trial terms are shown BEFORE submission: the first group
 * starts the 14-day trial and the paid relationship - the teacher must see
 * that before acting.
 */
export default function PrivateGroupModal({
  open,
  showTrialTerms,
  onClose,
  onCreated,
}: {
  open: boolean;
  showTrialTerms: boolean;
  onClose: () => void;
  onCreated: (group: CreatedGroup) => void;
}) {
  const t = useTranslations('teacherPortal.createGroup');

  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('nameRequired'));
      return;
    }
    const feeNum = Number(fee);
    if (!fee.trim() || !Number.isFinite(feeNum) || feeNum <= 0) {
      setError(t('feeInvalid'));
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
      const res = await fetch('/api/teacher/private/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: trimmed, fee_per_class: feeNum }),
      });
      const data = (await res.json()) as { group?: CreatedGroup; code?: string };
      if (res.ok && data.group) {
        setName('');
        setFee('');
        onCreated(data.group);
        return;
      }
      if (res.status === 403 && data.code === 'RESUBSCRIBE_REQUIRED') {
        setError(t('lapsedError'));
      } else if (res.status === 400 && data.code === 'invalid_name') {
        setError(t('nameRequired'));
      } else if (res.status === 400 && data.code === 'invalid_fee') {
        setError(t('feeInvalid'));
      } else {
        setError(t('genericError'));
      }
    } catch {
      setError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
            aria-label={t('cancel')}
          >
            <X className="h-5 w-5 text-[var(--color-text-secondary)]" />
          </button>
        </div>

        {showTrialTerms && (
          <div className="mb-4 rounded-lg border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--color-teal-deep)]" aria-hidden />
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                {t('trialTitle')}
              </h3>
            </div>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-[var(--color-text-secondary)]">
              <li>{t('trialLine1')}</li>
              <li>{t('trialLine2')}</li>
              <li>{t('trialLine3')}</li>
              <li>{t('trialLine4')}</li>
            </ul>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('feeLabel')}
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? t('creating') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
