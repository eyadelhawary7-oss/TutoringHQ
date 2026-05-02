/**
 * Locale rule for all numeric and date/time display:
 * - Arabic (`ar`, `ar-EG`, …) → Arabic-Indic numerals (`numberingSystem: 'arab'`) with `ar-EG`
 *   (Egypt); never `ar-AE` etc., so amounts are never formatted with Gulf currency symbols.
 * - otherwise → Western numerals via `en-US`
 *
 * Use `useLocale()` from next-intl in client components, or `getLocale()`
 * from `next-intl/server` in server components / route handlers when the
 * viewer’s locale is known; otherwise pass `'en'` for operator-only output.
 */
function isArabicLocale(locale: string): boolean {
  return locale === 'ar' || locale.startsWith('ar-');
}

function intlLocale(locale: string): string {
  return isArabicLocale(locale) ? 'ar-EG' : 'en-US';
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const l = intlLocale(locale);
  const opts = isArabicLocale(locale)
    ? { numberingSystem: 'arab' as const, ...options }
    : { ...options };
  return value.toLocaleString(l, opts);
}

/** Egyptian pound display for all Arabic UI (product is EGP-only). */
const EGP_AR_SUFFIX = '\u062c.\u0645';

export function formatCurrency(value: number, locale: string): string {
  const isAr = isArabicLocale(locale);
  if (!Number.isFinite(value)) {
    return isAr ? `\u0660 ${EGP_AR_SUFFIX}` : '0 EGP';
  }
  if (isAr) {
    const num = new Intl.NumberFormat('ar-EG', {
      numberingSystem: 'arab',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
    return `${num} ${EGP_AR_SUFFIX}`;
  }
  // /en/ spec: amount first, then ISO code (not "EGP 900" from Intl currency order).
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${num} EGP`;
}

export function formatPercent(value: number, locale: string): string {
  const l = intlLocale(locale);
  const isAr = isArabicLocale(locale);
  const p = Number(value);
  const safe = Number.isFinite(p) ? p : 0;
  const fraction = safe / 100;
  if (isAr) {
    const s = new Intl.NumberFormat(l, {
      numberingSystem: 'arab',
      style: 'percent',
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(fraction);
    // Intl often emits ASCII U+0025; Arabic UI expects U+066A (٪).
    return s.replace(/%/g, '\u066A');
  }
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(fraction);
}

export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const l = isArabicLocale(locale) ? 'ar-EG' : 'en-US';
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
  const l = isArabicLocale(locale) ? 'ar-EG' : 'en-US';
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
  const l = isArabicLocale(locale) ? 'ar-EG' : 'en-US';

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

  if (isArabicLocale(locale)) {
    return timeStr
      .replace(/AM/g, 'ص')
      .replace(/PM/g, 'م')
      .replace(/am/g, 'ص')
      .replace(/pm/g, 'م');
  }
  return timeStr;
}
