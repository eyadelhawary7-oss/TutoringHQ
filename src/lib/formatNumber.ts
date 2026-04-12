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

export function formatTime(timeStr: string, locale: string): string {
  if (locale !== 'ar') return timeStr;
  return timeStr
    .replace(/AM/g, 'ص')
    .replace(/PM/g, 'م')
    .replace(/am/g, 'ص')
    .replace(/pm/g, 'م');
}
