import * as Sentry from '@sentry/nextjs';

/**
 * `top_centers` monthly all-in must come from `centers.monthly_price` (inclusive). Missing = data bug.
 */
export function requireTopCentersMonthlyPrice(
  price: number | null | undefined,
  context = 'unknown',
): number {
  const n = price != null ? Number(price) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    Sentry.captureMessage(`top_centers monthly_price missing or invalid (${context})`, { level: 'warning' });
    throw new Error('top_centers_monthly_price_required');
  }
  return n;
}
