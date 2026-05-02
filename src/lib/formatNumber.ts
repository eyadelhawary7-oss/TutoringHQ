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
  if (!Number.isFinite(value)) {
    return locale === 'ar' ? '٠ ج.م' : '0 EGP';
  }
  const l = intlLocale(locale);
  if (locale === 'ar') {
    let s = new Intl.NumberFormat(l, {
      numberingSystem: 'arab',
      style: 'currency',
      currency: 'EGP',
      currencyDisplay: 'symbol',
    }).format(value);
    s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/جنيه\s*مصري|الجنيه\s*المصري|\bEGP\b|E£/gi, '').trim();
    s = s.replace(/\s+/g, ' ').trim();
    if (s.includes('ج.م')) return s;
    const num = new Intl.NumberFormat(l, {
      numberingSystem: 'arab',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
    return `${num} ج.م`;
  }
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${num} EGP`;
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

/** Map 12h clock + period to 24h hour (for Date construction). */
function hour12AndPeriodTo24(hour12: number, period: string): number {
  const p = period.trim();
  const isPM = p === 'PM' || p === 'pm' || p === 'م';
  const isAM = p === 'AM' || p === 'am' || p === 'ص';
  if (!isPM && !isAM) return hour12;
  if (isAM) return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

/**
 * Locale-aware time for display. Accepts ISO strings, "HH:MM", "HH:MM:SS",
 * or 12h strings (e.g. "9:00 AM", "1:00 PM") including Arabic ص/م suffixes.
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
    const mm = parseInt(hm[2]!, 10);
    const ss = hm[3] != null ? parseInt(hm[3]!, 10) : 0;
    const rest = timeStr.slice(hm[0].length).trim();
    const periodMatch = rest.match(/^(AM|PM|am|pm|ص|م)\s*$/);
    let hour24 = parseInt(hm[1]!, 10);
    if (periodMatch) {
      hour24 = hour12AndPeriodTo24(hour24, periodMatch[1]!);
    }
    const d = new Date(2000, 0, 1, hour24, mm, ss);
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
