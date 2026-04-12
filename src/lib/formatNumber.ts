export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';
  return value.toLocaleString(l, options);
}

export function formatCurrency(value: number, locale: string): string {
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';
  return value.toLocaleString(l) + (locale === 'ar' ? ' ج.م' : ' EGP');
}

export function formatPercent(value: number, locale: string): string {
  const l = locale === 'ar' ? 'ar-EG' : 'en-US';
  return value.toLocaleString(l) + '%';
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
