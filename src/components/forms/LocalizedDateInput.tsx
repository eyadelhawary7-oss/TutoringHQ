'use client';

import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { formatDate } from '@/lib/formatNumber';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'lang' | 'value' | 'onChange' | 'dir'
> & {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  locale: string;
  /** Shown under the field on Arabic locale so users see a localized date alongside the native picker. */
  showLocalizedHint?: boolean;
};

/**
 * Native date input with `lang` set for locale and an optional Arabic formatted hint (native pickers often follow OS locale).
 */
export function LocalizedDateInput({
  value,
  onChange,
  locale,
  showLocalizedHint = true,
  className,
  ...rest
}: Props) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  const hint =
    showLocalizedHint && locale === 'ar' && value
      ? formatDate(`${value}T12:00:00`, locale, { dateStyle: 'medium' })
      : null;

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <input
        type="date"
        lang={lang}
        dir="ltr"
        value={value}
        onChange={onChange}
        className={className}
        {...rest}
      />
      {hint ? (
        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums" aria-hidden>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
