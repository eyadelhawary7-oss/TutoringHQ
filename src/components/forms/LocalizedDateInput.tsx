'use client';

import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/formatNumber';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'lang' | 'value' | 'onChange' | 'dir' | 'className'
> & {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  locale: string;
  className?: string;
  /**
   * @deprecated Native field now shows a locale-formatted label; kept for API compatibility.
   */
  showLocalizedHint?: boolean;
};

function isoDateDisplay(value: string, locale: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '\u00a0';
  return formatDate(`${value}T12:00:00`, locale, { dateStyle: 'medium' });
}

/**
 * Native `type="date"` (ISO value) with a locale-visible label - avoids Western-only
 * strings like "02-May-2026" on /ar when the browser paints the native field on top.
 * The input sits behind an opaque overlay; clicks pass through (`pointer-events-none`).
 */
export function LocalizedDateInput({
  value,
  onChange,
  locale,
  showLocalizedHint: _showLocalizedHint = false,
  className,
  ...rest
}: Props) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  const display = isoDateDisplay(value, locale);
  const ariaLabel = display.trim() ? display : 'Select date';

  return (
    <div
      className={cn(
        'relative flex min-h-[2.5rem] w-full min-w-0 items-stretch overflow-hidden',
        className,
      )}
    >
      <input
        type="date"
        lang={lang}
        dir="ltr"
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className="chq-localized-date-native absolute inset-0 z-0 h-full min-h-[2.5rem] w-full min-w-0 cursor-pointer opacity-0"
        {...rest}
      />
      <span
        className="pointer-events-none absolute inset-0 z-[1] flex min-w-0 items-center text-start rounded-[inherit] bg-inherit text-sm tabular-nums text-inherit"
        aria-hidden
      >
        {display}
      </span>
    </div>
  );
}
