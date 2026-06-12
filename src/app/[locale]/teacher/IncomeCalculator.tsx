'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Calculator } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';

/**
 * Income calculator (free zone only). Two sliders estimate a teacher's monthly
 * private income live. Marketing surface - no data is read or written; the CTA
 * starts the trial / first-group flow.
 */
export default function IncomeCalculator({ onStartTrial }: { onStartTrial: () => void }) {
  const t = useTranslations('teacherPortal.calculator');
  const locale = useLocale();

  const [students, setStudents] = useState(15);
  const [fee, setFee] = useState(350);

  const gross = students * 4 * fee; // weekly sessions assumed
  const centerHqFee = Math.round(gross * 0.05);

  return (
    <section>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Calculator size={18} className="text-[var(--color-brass)]" aria-hidden />
          {t('heading')}
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('subheading')}</p>

        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label htmlFor="calc-students" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('studentsLabel')}
              </label>
              <span className="num text-sm font-semibold text-[var(--color-text-primary)]">
                {t('studentsValue', { count: formatNumber(students, locale) })}
              </span>
            </div>
            <input
              id="calc-students"
              type="range"
              min={1}
              max={50}
              step={1}
              value={students}
              onChange={(e) => setStudents(Number(e.target.value))}
              className="w-full accent-[var(--color-brass)]"
            />
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label htmlFor="calc-fee" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('feeLabel')}
              </label>
              <span className="num text-sm font-semibold text-[var(--color-text-primary)]">
                {t('feeValue', { amount: formatCurrency(fee, locale) })}
              </span>
            </div>
            <input
              id="calc-fee"
              type="range"
              min={100}
              max={1000}
              step={50}
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="w-full accent-[var(--color-brass)]"
            />
          </div>
        </div>

        <div className="mt-6 rounded-[var(--radius-card)] bg-[var(--color-surface-2)] p-5 text-center">
          <p className="mb-1 text-sm text-[var(--color-text-secondary)]">{t('resultLabel')}</p>
          <p className="num text-4xl font-bold text-[var(--color-teal-deep)]">
            {formatCurrency(gross, locale)}
          </p>
          <p className="num mt-2 text-xs text-[var(--color-text-muted)]">
            {t('feeNote', { fee: formatCurrency(centerHqFee, locale) })}
          </p>
        </div>

        <button
          type="button"
          onClick={onStartTrial}
          className="mt-5 w-full rounded-[18px] bg-[var(--color-brass)] px-5 py-3 font-semibold text-white shadow-card transition-opacity hover:opacity-90"
        >
          {t('cta')}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--color-text-muted)]">{t('note')}</p>
      </div>
    </section>
  );
}
