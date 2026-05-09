/**
 * Centralized locale-aware number, currency, percent, growth, and date display.
 * Currency: amount first, NBSP, suffix (EGP / ج.م). Dates: Africa/Cairo; AR uses Eastern Arabic digits.
 */

const CAIRO_TZ = 'Africa/Cairo';
const NBSP = '\u00A0';
const MINUS = '\u2212'; // −
const EGP_EN_SUFFIX = 'EGP';
const EGP_AR_SUFFIX = '\u062c.\u0645';

function isArabicLocale(locale: string): boolean {
  return locale === 'ar' || locale.startsWith('ar-');
}

function intlLocale(locale: string): string {
  return isArabicLocale(locale) ? 'ar-EG' : 'en-US';
}

export type FormatNumberOptions = Intl.NumberFormatOptions & {
  /** When true, round to integer and show no fraction digits. */
  integerOnly?: boolean;
};

export function formatNumber(value: number, locale: string, options?: FormatNumberOptions): string {
  const l = intlLocale(locale);
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;

  const { integerOnly, ...rest } = options ?? {};
  if (integerOnly) {
    n = Math.round(n);
  }

  const base: Intl.NumberFormatOptions = {
    minimumFractionDigits: integerOnly ? 0 : (rest.minimumFractionDigits ?? 0),
    maximumFractionDigits: integerOnly ? 0 : (rest.maximumFractionDigits ?? 0),
    ...rest,
  };

  const opts = isArabicLocale(locale)
    ? { numberingSystem: 'arab' as const, ...base }
    : base;
  return n.toLocaleString(l, opts);
}

/** Calendar years, quarter numbers, etc.: never digit-grouping (`2026` not `2,026`). */
export function formatPlainInteger(value: number, locale: string): string {
  const n = Math.round(Number(value));
  const safe = Number.isFinite(n) ? n : 0;
  return formatNumber(safe, locale, { useGrouping: false, maximumFractionDigits: 0 });
}

export function formatCurrency(value: number, locale: string): string {
  const isAr = isArabicLocale(locale);
  const n = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(n);
  const num = formatNumber(rounded, locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const suffix = isAr ? EGP_AR_SUFFIX : EGP_EN_SUFFIX;
  return `${num}${NBSP}${suffix}`;
}

export type FormatPercentOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/**
 * Renders numeric percent (e.g. 15 → "15%" / Arabic digits + ٪). Strips U+061C.
 */
export function formatPercent(value: number, locale: string, options?: FormatPercentOptions): string {
  const isAr = isArabicLocale(locale);
  const minF = options?.minimumFractionDigits ?? 0;
  const maxF = options?.maximumFractionDigits ?? 2;
  const p = Number(value);
  const safe = Number.isFinite(p) ? p : 0;
  const numStr = formatNumber(safe, locale, {
    minimumFractionDigits: minF,
    maximumFractionDigits: maxF,
  });
  const sym = isAr ? '\u066A' : '%';
  return `${numStr}${sym}`.replace(/\u061C/g, '');
}

/**
 * Growth percent vs prior period. Null when prior === 0.
 * Uses −100.0% when current === 0 and prior > 0.
 */
export function formatGrowth(current: number, prior: number, locale: string): string | null {
  if (prior === 0) return null;
  if (current === 0 && prior > 0) {
    const s = formatPercent(-100, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return s.replace(/^-/, MINUS);
  }
  const pct = ((current - prior) / prior) * 100;
  const s = formatPercent(pct, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return s.replace(/^-/, MINUS);
}

function mergeDateOpts(
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  const isAr = isArabicLocale(locale);
  const base: Intl.DateTimeFormatOptions = { timeZone: CAIRO_TZ, ...opts };
  if (isAr) {
    return { ...base, numberingSystem: 'arab' as const };
  }
  return base;
}

export function formatDate(
  date: Date | string,
  locale: string,
  formatOrOptions?: 'short' | 'long' | 'time' | Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';

  if (formatOrOptions && typeof formatOrOptions === 'object') {
    const l = intlLocale(locale);
    return new Intl.DateTimeFormat(l, mergeDateOpts(locale, formatOrOptions)).format(d);
  }

  const fmt = formatOrOptions ?? 'long';
  const l = intlLocale(locale);

  if (fmt === 'time') {
    return new Intl.DateTimeFormat(l, mergeDateOpts(locale, { hour: 'numeric', minute: '2-digit' })).format(d);
  }

  if (fmt === 'short') {
    return new Intl.DateTimeFormat(
      l,
      mergeDateOpts(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    ).format(d);
  }

  return new Intl.DateTimeFormat(
    l,
    mergeDateOpts(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
  ).format(d);
}

export function formatDateTime(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const l = intlLocale(locale);
  const opts = options ?? {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat(l, mergeDateOpts(locale, opts)).format(d);
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
  const timeFmtOpts: Intl.DateTimeFormatOptions = isArabicLocale(locale)
    ? {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        numberingSystem: 'arab',
        timeZone: CAIRO_TZ,
      }
    : {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: CAIRO_TZ,
      };

  if (timeInput instanceof Date) {
    if (Number.isNaN(timeInput.getTime())) return '';
    return timeInput.toLocaleTimeString(l, mergeDateOpts(locale, timeFmtOpts));
  }

  const timeStr = String(timeInput).trim();
  if (!timeStr) return '';

  if (timeStr.includes('T')) {
    const d = new Date(timeStr);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString(l, mergeDateOpts(locale, timeFmtOpts));
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
    return d.toLocaleTimeString(l, mergeDateOpts(locale, timeFmtOpts));
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
