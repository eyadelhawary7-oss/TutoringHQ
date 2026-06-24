'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Info } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { formatNumber } from '@/lib/formatNumber';
import {
  buildRedesignedInvoiceLines,
  processingFeeInfoBodyAr,
  processingFeeInfoBodyEn,
  PROCESSING_FEE_INFO_TITLE_AR,
  PROCESSING_FEE_INFO_TITLE_EN,
  PROCESSING_FEE_INFO_DISMISS_AR,
  PROCESSING_FEE_INFO_DISMISS_EN,
} from '@/lib/processingFee';

/**
 * Small ⓘ button that opens the processing-fee explanation sheet (Section 5),
 * with a "تمام" dismiss button. The amount is interpolated so the copy stays
 * correct if the fee changes (e.g. back to 9).
 */
export function ProcessingFeeInfoButton({ amount }: { amount: number }) {
  const locale = useLocale();
  const isAr = locale !== 'en';
  const [open, setOpen] = useState(false);
  const title = isAr ? PROCESSING_FEE_INFO_TITLE_AR : PROCESSING_FEE_INFO_TITLE_EN;
  const body = isAr ? processingFeeInfoBodyAr(amount) : processingFeeInfoBodyEn(amount);
  const dismiss = isAr ? PROCESSING_FEE_INFO_DISMISS_AR : PROCESSING_FEE_INFO_DISMISS_EN;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        className="btn-press chq-focus inline-flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] align-middle ms-1"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-press chq-focus rounded-lg bg-[var(--color-brand-500)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {dismiss}
          </button>
        </div>
      </Modal>
    </>
  );
}

/**
 * Customer-facing invoice breakdown (Section 5 order):
 *   قيمة الاشتراك → رسوم المعالجة (ⓘ) → الإجمالي → ضريبة القيمة المضافة (مشمولة).
 *
 * @param total The charged total (subscription + fee) — invoices.total_amount.
 * @param fee   The fee snapshotted on the invoice (metadata.processing_fee); 0 hides the line.
 */
export function ProcessingFeeBreakdown({
  total,
  fee,
  className,
}: {
  total: number;
  fee: number;
  className?: string;
}) {
  const locale = useLocale();
  const lineLocale = locale === 'en' ? 'en' : 'ar';
  const lines = buildRedesignedInvoiceLines({ total, fee, locale: lineLocale });

  return (
    <div className={['flex flex-col gap-1.5', className ?? ''].join(' ')}>
      {lines.map((line) => {
        const amount = `${formatNumber(line.amount, locale)} EGP`;
        if (line.isTotal) {
          return (
            <div
              key={line.key}
              className="mt-1 flex items-center justify-between border-t border-[var(--color-border)] pt-2 text-base font-bold text-[var(--color-text-primary)]"
            >
              <span>{line.label}</span>
              <span className="tabular-nums">{amount}</span>
            </div>
          );
        }
        return (
          <div
            key={line.key}
            className={[
              'flex items-center justify-between text-sm',
              line.isVatNote
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-text-secondary)]',
            ].join(' ')}
          >
            <span className="inline-flex items-center">
              {line.label}
              {line.hasInfo ? <ProcessingFeeInfoButton amount={line.amount} /> : null}
            </span>
            <span className="tabular-nums">{amount}</span>
          </div>
        );
      })}
    </div>
  );
}
