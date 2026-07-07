import { NextResponse } from 'next/server';

/**
 * RETIRED — this legacy route created a center with `subscription_status:
 * 'active'` and a full-permission owner row for ANY authenticated Supabase user
 * with no `users.center_id`, with no payment, no invoice, and no billing anchor
 * (`next_payment_due` was never set, so no billing cron would ever charge or
 * suspend it). It was a payment-bypass center factory reachable by anyone who
 * could mint an auth user (e.g. the teacher-signup flow), and had no frontend
 * caller (grep-confirmed).
 *
 * Center creation is now exclusively the paid path:
 *   /api/signup  ->  Paymob first-payment webhook (HMAC + idempotency)
 *   ->  processInvoiceSignupAfterPaymobSuccess (activates the center + owner).
 *
 * The route is kept only to return a hard 410 so any stale client fails loudly
 * instead of silently minting a free center. Do NOT re-add center-creation
 * logic here — extend the signup/activation flow instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has been retired.',
      code: 'ONBOARDING_ROUTE_RETIRED',
      details:
        'Centers are created only through the paid signup + payment flow (/api/signup).',
    },
    { status: 410 },
  );
}
