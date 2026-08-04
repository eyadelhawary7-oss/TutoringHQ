import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { parseBodyWithLimit } from '@/lib/validate';
import { validateCSRFRequest } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

const PLAN_RANK: Record<string, number> = {
  solo: 1,
  nano: 2,
  starter: 3,
  pro: 4,
  business: 5,
  enterprise: 6,
  top_centers: 7,
};

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // S8: schedules a plan downgrade for next renewal - no CSRF check existed.
  // Matches the pattern already used by billing/cancel and billing/withdrawal.
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { newPlan?: string; newBillingPeriod?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const newPlan = typeof body.newPlan === 'string' ? body.newPlan.trim() : '';
  const newBillingPeriodRaw =
    typeof body.newBillingPeriod === 'string' ? body.newBillingPeriod.trim() : '';

  if (!newPlan || !newBillingPeriodRaw) {
    return NextResponse.json({ error: 'newPlan and newBillingPeriod required' }, { status: 400 });
  }

  if (!isPlanKey(newPlan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  // Quarterly is retired — coerce any legacy/stale client value to monthly so
  // the scheduled downgrade can never carry a period the centers CHECKs reject.
  const requestedBp = normalizeBillingPeriod(newBillingPeriodRaw) as BillingPeriod;
  const newBp: BillingPeriod = requestedBp === 'annual' ? 'annual' : 'monthly';
  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, plan, status, subscription_status, billing_status, subscription_billing_period, billing_period, all_in_price, next_payment_due, billing_type, pricing_type',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    plan?: string;
    status?: string;
    subscription_status?: string | null;
    billing_status?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
    all_in_price?: number | null;
    next_payment_due?: string | null;
    billing_type?: string | null;
    pricing_type?: string | null;
  };

  if (
    c.status !== 'active' ||
    c.subscription_status !== 'active' ||
    !['active', 'paid'].includes(String(c.billing_status ?? '').toLowerCase())
  ) {
    return NextResponse.json(
      { error: 'Center must be active and paid to downgrade' },
      { status: 400 },
    );
  }

  if (newPlan === 'top_centers') {
    return NextResponse.json(
      { error: 'Top Centers plan requires manual admin setup' },
      { status: 400 },
    );
  }

  const currentPlan = c.plan ?? 'starter';
  const currentRank = PLAN_RANK[currentPlan] ?? 1;
  const newRank = PLAN_RANK[newPlan] ?? 0;

  if (newRank >= currentRank) {
    return NextResponse.json({ error: 'Use upgrade flow for higher plans' }, { status: 400 });
  }

  const npd = c.next_payment_due?.slice(0, 10);
  if (!npd) {
    return NextResponse.json({ error: 'Missing next payment due' }, { status: 400 });
  }

  // Validate the target plan exists (price sanity), but DO NOT change anything now.
  const { data: newPriceRow } = await supabaseAdmin
    .from('pricing_plans')
    .select('all_in_price')
    .eq('plan_key', newPlan)
    .eq('is_active', true)
    .maybeSingle();
  const newAllInFromDb = Number(newPriceRow?.all_in_price ?? 0);
  const newAllIn =
    (Number.isFinite(newAllInFromDb) && newAllInFromDb > 0
      ? newAllInFromDb
      : PLANS[newPlan as PlanKey]?.quarterlyAllIn) ?? 0;
  if (!Number.isFinite(newAllIn) || newAllIn <= 0) {
    return NextResponse.json({ error: 'Plan pricing unavailable' }, { status: 400 });
  }

  // Unified rule 3 (G1/G3/G4): a downgrade is SCHEDULED for the next renewal — no
  // charge, no refund, and NO credit (we no longer mint wallet credit on downgrade,
  // which was the worst bypass). The current plan, its limits, its price and its
  // overage stay fully in force until the recurring engine applies this at npd.
  const { error: upErr } = await supabaseAdmin
    .from('centers')
    .update({ scheduled_plan: newPlan, scheduled_billing_period: newBp })
    .eq('id', centerId);

  if (upErr) {
    console.error('[billing/downgrade] schedule', upErr);
    return NextResponse.json({ error: 'Failed to schedule downgrade' }, { status: 500 });
  }

  return NextResponse.json({
    scheduled: true,
    creditEarned: 0,
    newPlan,
    newBillingPeriod: newBp,
    effectiveDate: npd, // takes effect at the next renewal, not now
  });
}
