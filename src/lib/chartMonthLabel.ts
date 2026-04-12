import { formatDate } from '@/lib/formatNumber';

export const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

/**
 * X-axis / tooltip labels for charts: YYYY-MM, YYYY-MM-DD, week token Wn, or legacy English month strings.
 */
export function formatChartMonthLabel(raw: string | number, locale: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^W\d+$/i.test(s)) return s;

  const ym = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    const idx = m - 1;
    if (idx < 0 || idx > 11) return s;
    if (locale === 'ar') return ARABIC_MONTHS[idx] ?? s;
    const d = new Date(y, idx, 1);
    return formatDate(d, locale, { month: 'short', year: '2-digit' });
  }

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (!Number.isNaN(d.getTime())) {
      if (locale === 'ar') return ARABIC_MONTHS[d.getMonth()] ?? s;
      return formatDate(d, locale, { month: 'short', year: '2-digit' });
    }
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    if (locale === 'ar') return ARABIC_MONTHS[d.getMonth()] ?? s;
    return d.toLocaleDateString('en-US', { month: 'short' });
  }

  return s;
}
