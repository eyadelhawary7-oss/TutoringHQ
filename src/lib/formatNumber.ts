/**
 * Locale rule for all numeric and date/time display:
 * - `locale === 'ar'` → Arabic-Indic numerals (`numberingSystem: 'arab'`) with `ar-EG`
 * - otherwise → Western numerals via `en-US`
 *
 * Use `useLocale()` from next-intl in client components, or `getLocale()`
 * from `next-intl/server` in server components / route handlers when the
 * viewer’s locale is known; otherwise pass `'en'` for operator-only output.
 */
function intlLocale(locale: string): string {
  return locale === 'ar' ? 'ar-EG' : 'en-US';
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const l = intlLocale(locale);
  const opts =
    locale === 'ar'
      ? { numberingSystem: 'arab' as const, ...options }
      : { ...options };
  return value.toLocaleString(l, opts);
}

export function formatCurrency(value: number, locale: string): string {
  const l = intlLocale(locale);
  const opts = locale === 'ar' ? ({ numberingSystem: 'arab' } as Intl.NumberFormatOptions) : undefined;
  return value.toLocaleString(l, opts) + (locale === 'ar' ? ' ج.م' : ' EGP');
}

export function formatPercent(value: number, locale: string): string {
  const l = intlLocale(locale);
  const numOpts: Intl.NumberFormatOptions = {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    ...(locale === 'ar' ? { numberingSystem: 'arab' as const } : {}),
  };
  const num = value.toLocaleString(l, numOpts);
  return locale === 'ar' ? `${num}\u066A` : `${num}%`;
}

export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';
  const opts: Intl.DateTimeFormatOptions =
    options ?? {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    };
  return d.toLocaleDateString(l, opts);
}

export function formatDateTime(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';
  return d.toLocaleString(l, options);
}

/**
 * Locale-aware time for display. Accepts ISO strings, "HH:MM", "HH:MM:SS",
 * or 12h English strings (e.g. "9:00 AM") for AM/PM localization in Arabic.
 */
export function formatTime(timeInput: string | Date, locale: string): string {
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';

  if (timeInput instanceof Date) {
    if (Number.isNaN(timeInput.getTime())) return '';
    return timeInput.toLocaleTimeString(l, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  const timeStr = String(timeInput).trim();
  if (!timeStr) return '';

  if (timeStr.includes('T')) {
    const d = new Date(timeStr);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString(l, { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }

  const hm = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (hm) {
    const hh = parseInt(hm[1]!, 10);
    const mm = parseInt(hm[2]!, 10);
    const d = new Date(2000, 0, 1, hh, mm, 0);
    return d.toLocaleTimeString(l, { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  if (locale === 'ar') {
    return timeStr
      .replace(/AM/g, 'ص')
      .replace(/PM/g, 'م')
      .replace(/am/g, 'ص')
      .replace(/pm/g, 'م');
  }
  return timeStr;
}
