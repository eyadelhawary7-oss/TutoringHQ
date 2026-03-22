'use client';

import { useTranslations } from 'next-intl';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
  amount: number;
  method: string;
  paidAt: string | Date;
  methodLabel: string;
};

export function ReceiptModal({
  isOpen,
  onClose,
  studentName,
  amount,
  method: _method,
  paidAt,
  methodLabel,
}: Props) {
  const t = useTranslations('payments');

  if (!isOpen) return null;

  const dateStr = new Date(paidAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="receipt-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('receipt_title')}
    >
      <div className="receipt-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-full bg-[var(--color-success)] flex items-center justify-center">
            <svg width="28" height="28" fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">{t('confirm_success')}</h2>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          {[
            { label: t('receipt_student'), value: studentName },
            {
              label: t('receipt_amount'),
              value: `${Number(amount).toLocaleString('en-US')} ${t('egp')}`,
            },
            { label: t('receipt_method'), value: methodLabel },
            { label: t('receipt_date'), value: dateStr },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3 last:border-b-0 last:pb-0"
            >
              <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{value}</span>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose} className="btn btn-primary w-full">
          {t('receipt_close')}
        </button>
      </div>
    </div>
  );
}
