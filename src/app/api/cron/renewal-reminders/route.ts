/**
 * RETIRED. The freeform 7-day / 1-day renewal reminders this route used to send
 * are superseded by the unified billing-nudges engine (src/lib/nudges →
 * /api/cron/billing-nudges), which is the single source of center + teacher
 * dunning (pre-billing T-3/T-1, due-today/grace, post-lock) plus the in-app
 * banner. This route is no longer scheduled in vercel.json; the handler remains
 * only so any stale trigger no-ops instead of double-nudging.
 */
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ skipped: 'retired_use_billing_nudges' }, { status: 200 });
}

export async function GET(request: Request) {
  return POST(request);
}
