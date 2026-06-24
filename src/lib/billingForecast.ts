// src/lib/billingForecast.ts
//
// Pure computation of the "upcoming charge" FORECAST shown on the customer
// invoices page (Phase 3c). This is a PREVIEW only — it is never persisted as an
// invoice. It only becomes a real invoice when the billing date arrives and the
// Phase 2 midnight cron creates one. (Mirrors how Stripe shows an upcoming
// invoice as a preview.)
//
// The expected next charge = subscription price (VAT-inclusive billing_amount) +
// the flat processing fee — exactly what the cron will charge. Because plan
// changes / proration can alter it, it is flagged `estimated`.
//
// PURE (no Supabase, no Date) so it is unit-tested.

import { round2 } from '@/lib/invoiceBalance';

export interface UpcomingForecast {
  /** Always true — marks this as a non-payable preview line, never an invoice. */
  isForecast: true;
  /** Expected next charge total (subscription + processing fee). */
  amount: number;
  /** Subscription portion (VAT-inclusive). */
  subscription: number;
  /** Flat processing fee that will be added (0 when disabled). */
  fee: number;
  /** Date of the next charge (YYYY-MM-DD). */
  date: string;
  /** The amount may change (plan change / proration) — show as an estimate. */
  estimated: true;
}

/**
 * Build the upcoming-charge forecast, or null when there is nothing to forecast
 * (no active subscription, no next date, or no positive amount).
 *
 * @param nextPaymentDue centers.next_payment_due (date-ish string) or null.
 * @param billingAmount  centers.billing_amount (subscription, VAT-inclusive).
 * @param processingFee  the currently-configured flat fee (0 when disabled).
 * @param subscriptionActive whether the subscription is ongoing (forecast only then).
 */
export function computeUpcomingForecast(opts: {
  nextPaymentDue: string | null | undefined;
  billingAmount: number | null | undefined;
  processingFee: number;
  subscriptionActive: boolean;
}): UpcomingForecast | null {
  if (!opts.subscriptionActive) return null;

  const date = typeof opts.nextPaymentDue === 'string' ? opts.nextPaymentDue.slice(0, 10) : '';
  if (!date) return null;

  const subscription = round2(Number(opts.billingAmount ?? 0));
  if (!Number.isFinite(subscription) || subscription <= 0) return null;

  const fee = Math.max(0, round2(Number(opts.processingFee) || 0));
  const amount = round2(subscription + fee);

  return {
    isForecast: true,
    amount,
    subscription,
    fee,
    date,
    estimated: true,
  };
}
