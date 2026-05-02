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
 * Native `type="date"` (ISO value) with a locale-visible label — avoids Western-only
 * strings like "02-May-2026" on /ar when the OS/browser ignores `lang`.
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
    <div className={cn('relative flex min-h-[2.5rem] w-full min-w-0 items-center', className)}>
      <span
        className="pointer-events-none relative z-0 block w-full min-w-0 truncate text-start text-sm text-[var(--color-text-primary)] tabular-nums"
        aria-hidden
      >
        {display}
      </span>
      <input
        type="date"
        lang={lang}
        dir="ltr"
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className="absolute inset-0 z-[1] h-full w-full cursor-pointer opacity-0"
        {...rest}
      />
    </div>
  );
}
