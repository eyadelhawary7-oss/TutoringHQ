'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type RefundModalVariant = 'approve' | 'reject' | 'mark_paid';

export function RefundActionModal({
  open,
  variant,
  loading,
  rejectReason,
  onRejectReasonChange,
  externalReference,
  onExternalReferenceChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  variant: RefundModalVariant | null;
  loading: boolean;
  rejectReason: string;
  onRejectReasonChange: (v: string) => void;
  externalReference: string;
  onExternalReferenceChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations('admin.cardRefunds.modal');

  if (!open || !variant) return null;

  const title =
    variant === 'approve'
      ? t('approveTitle')
      : variant === 'reject'
        ? t('rejectTitle')
        : t('markPaidTitle');

  const rejectTooShort = variant === 'reject' && rejectReason.trim().length > 0 && rejectReason.trim().length < 10;
  const rejectTooLong = variant === 'reject' && rejectReason.trim().length > 500;
  const disableConfirm =
    loading ||
    (variant === 'reject' && (rejectReason.trim().length < 10 || rejectReason.trim().length > 500)) ||
    (variant === 'mark_paid' && !externalReference.trim());

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div
        className={cn(
          'w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-lg space-y-4',
        )}
        role="dialog"
        aria-modal
        aria-labelledby="refund-modal-title"
      >
        <h2 id="refund-modal-title" className="text-lg font-bold text-[var(--color-text-primary)]">
          {title}
        </h2>

        {variant === 'approve' ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{t('approveBody')}</p>
        ) : null}

        {variant === 'reject' ? (
          <div className="space-y-2">
            <label htmlFor="refund-reject-reason" className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('rejectReasonLabel')}
            </label>
            <textarea
              id="refund-reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => onRejectReasonChange(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              placeholder={t('rejectReasonPlaceholder')}
            />
            <p className="text-xs text-[var(--color-text-muted)]">{t('rejectReasonHint')}</p>
            {rejectTooShort ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">{t('rejectTooShort')}</p>
            ) : null}
            {rejectTooLong ? (
              <p className="text-xs text-red-700 dark:text-red-400">{t('rejectTooLong')}</p>
            ) : null}
          </div>
        ) : null}

        {variant === 'mark_paid' ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('markPaidBody')}</p>
            <div className="space-y-2">
              <label htmlFor="paymob-ref-id" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('externalRefLabel')}
              </label>
              <input
                id="paymob-ref-id"
                type="text"
                value={externalReference}
                onChange={(e) => onExternalReferenceChange(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                placeholder={t('externalRefPlaceholder')}
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[var(--color-border-subtle)] text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={disableConfirm}
            onClick={() => void onConfirm()}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50',
              variant === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700',
            )}
          >
            {loading ? t('working') : variant === 'approve' ? t('confirmApprove') : variant === 'reject' ? t('confirmReject') : t('confirmMarkPaid')}
          </button>
        </div>
      </div>
    </div>
  );
}
