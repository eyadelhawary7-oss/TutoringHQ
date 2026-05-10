'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';

export function CancelOrderModal({
  orderId,
  status,
  open,
  onClose,
  onDone,
}: {
  orderId: string;
  status: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const tcancel = useTranslations('cardOrderCancel');
  const [reasonCode, setReasonCode] = useState<
    'wrong_quantity' | 'wrong_students' | 'no_longer_needed' | 'other'
  >('no_longer_needed');
  const [otherDetail, setOtherDetail] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canAct = status === 'pending_payment';

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Unauthorized');

      const body: Record<string, unknown> = { reason_code: reasonCode };
      if (reasonCode === 'other') body.reason_detail = otherDetail.trim();

      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(
          j.message ??
            (j.error === 'cannot_cancel_paid_order' ? tcancel('errors.alreadyPaid') : undefined) ??
            j.error ??
            res.statusText,
        );
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tcancel('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  const otherOk = reasonCode !== 'other' || (otherDetail.trim().length >= 10 && otherDetail.trim().length <= 500);
  const canSubmit = canAct && confirmText === 'CANCEL' && otherOk && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="cancel-order-title"
        className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-xl p-5 space-y-4"
      >
        <h2 id="cancel-order-title" className="text-lg font-bold text-[var(--color-text-primary)]">
          {tcancel('title')}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {canAct ? tcancel('warning.beforePayment') : tcancel('errors.alreadyPaid')}
        </p>

        {canAct ? (
          <>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {tcancel('reasonLabel')}
              <select
                className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
              >
                <option value="wrong_quantity">{tcancel('reason.wrong_quantity')}</option>
                <option value="wrong_students">{tcancel('reason.wrong_students')}</option>
                <option value="no_longer_needed">{tcancel('reason.no_longer_needed')}</option>
                <option value="other">{tcancel('reason.other')}</option>
              </select>
            </label>

            {reasonCode === 'other' ? (
              <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                {tcancel('otherDetailLabel')}
                <textarea
                  className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm min-h-[96px]"
                  value={otherDetail}
                  onChange={(e) => setOtherDetail(e.target.value)}
                  maxLength={500}
                />
              </label>
            ) : null}

            <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
              {tcancel('confirmTypeLabel')}
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm font-mono"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            className="px-4 py-2 rounded-xl border border-[var(--color-border-subtle)] text-sm font-semibold"
            onClick={onClose}
            disabled={submitting}
          >
            {tcancel('back')}
          </button>
          {canAct ? (
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-40"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {tcancel('confirm')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
