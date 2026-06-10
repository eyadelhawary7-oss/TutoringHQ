'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * Teacher-initiated add-student modal. The payer toggle decides whose phone
 * receives the bill later (finish_class_and_bill snapshots the payer's phone
 * onto every charge), so the copy is explicit and the parent phone is
 * required when the parent pays.
 */
export default function AddStudentModal({
  groupId,
  open,
  onClose,
  onAdded,
}: {
  groupId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useTranslations('teacherPortal.addStudent');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payer, setPayer] = useState<'student' | 'parent'>('student');
  const [parentPhone, setParentPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('nameRequired'));
      return;
    }
    if (!phone.trim()) {
      setError(t('phoneInvalid'));
      return;
    }
    if (payer === 'parent' && !parentPhone.trim()) {
      setError(t('parentPhoneInvalid'));
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
      const res = await fetch(`/api/teacher/private/groups/${groupId}/roster`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          payer,
          parent_phone: payer === 'parent' ? parentPhone.trim() : undefined,
        }),
      });
      const data = (await res.json()) as { code?: string };
      if (res.ok) {
        setName('');
        setPhone('');
        setParentPhone('');
        setPayer('student');
        onAdded();
        return;
      }
      if (data.code === 'duplicate_enrollment') setError(t('duplicate'));
      else if (data.code === 'capacity_full') setError(t('capacityFull'));
      else if (data.code === 'invalid_phone') setError(t('phoneInvalid'));
      else if (data.code === 'invalid_parent_phone') setError(t('parentPhoneInvalid'));
      else if (data.code === 'invalid_name') setError(t('nameRequired'));
      else setError(t('genericError'));
    } catch {
      setError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const payerBtnClass = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-[var(--color-teal)] bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
        : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
    }`;

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

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('phoneLabel')}
          </label>
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01xxxxxxxxx"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('payerLabel')}
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPayer('student')} className={payerBtnClass(payer === 'student')}>
              {t('payerStudent')}
            </button>
            <button type="button" onClick={() => setPayer('parent')} className={payerBtnClass(payer === 'parent')}>
              {t('payerParent')}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('payerHint')}</p>
        </div>

        {payer === 'parent' && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('parentPhoneLabel')}
            </label>
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:ring-2 focus:ring-teal-500"
            />
          </div>
        )}

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
            {submitting ? t('adding') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
