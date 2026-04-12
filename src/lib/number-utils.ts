import { formatNumber } from '@/lib/formatNumber';

/**
 * Converts a number to Arabic-Indic numeral string (ar-EG locale).
 */
export function toAr(n: number): string {
  return formatNumber(n, 'ar');
}
