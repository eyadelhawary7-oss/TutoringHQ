// /api/pricing/plans
// Public, read-only marketing view of fixed-tier plan prices for the landing
// page, the /pricing page, and the signup plan picker. No auth, no secrets.
//
// Why this exists: the synchronous `PLANS` constant in `@/lib/pricing` is the
// source of truth for billing engines, MRR aggregates, and hundreds of
// server / client call sites - it must stay synchronous. This endpoint is the
// dynamic DISPLAY-ONLY surface that picks up pricing_plans edits made via
// /admin/pricing without a redeploy. Hardcoded `PLANS[k].*` values are used
// as fallbacks when the row is missing or the service-role client cannot be
// constructed (e.g. at build-time without env vars).
//
// Cached for 60s with a 5-min stale-while-revalidate window so admin edits
// propagate quickly without hammering the DB on every public page view.

import { NextResponse } from 'next/server';
import { getPublicPlanPrices } from '@/lib/pricingConfig';

export const revalidate = 60;

export async function GET() {
  const plans = await getPublicPlanPrices();
  return NextResponse.json(
    { plans },
    {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
