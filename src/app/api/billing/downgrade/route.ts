import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { earnCredits, getCreditBalance, getDailyRate, isPaygCenter } from '@/lib/billingEngine';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { todayISO } from '@/lib/parentPack';
import { parseBodyWithLimit } from '@/lib/validate';

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

  const newBp = normalizeBillingPeriod(newBillingPeriodRaw) as BillingPeriod;
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

  if (isPaygCenter(c)) {
    return NextResponse.json(
      { error: 'Pay As You Go uses the billing settings tab to change plans' },
      { status: 400 },
    );
  }

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

  const currentBp = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  ) as BillingPeriod;

  const npd = c.next_payment_due?.slice(0, 10);
  if (!npd) {
    return NextResponse.json({ error: 'Missing next payment due' }, { status: 400 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${npd}T12:00:00`);
  due.setHours(0, 0, 0, 0);
  const remainingDays = Math.max(
    0,
    Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const currentPk = isPlanKey(currentPlan) ? currentPlan : 'starter';
  const currentAllIn =
    Number(c.all_in_price ?? 0) ||
    (PLANS[currentPk as PlanKey]?.quarterlyAllIn ?? PLANS.starter.quarterlyAllIn);

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

  const currentPeriodPrice = getChargeFromQuarterlyAllIn(
    currentAllIn,
    currentBp,
    currentPk as PlanKey,
  );
  const newPeriodPrice = getChargeFromQuarterlyAllIn(newAllIn, newBp, newPlan as PlanKey);

  const rateCtx = { billing_type: c.billing_type, pricing_type: c.pricing_type };
  const currentDailyRate = getDailyRate(currentPeriodPrice, currentBp, rateCtx);
  const newDailyRate = getDailyRate(newPeriodPrice, newBp, rateCtx);
  const creditAmount = Math.max(0, (currentDailyRate - newDailyRate) * remainingDays);
  const creditRounded = Math.round(creditAmount * 100) / 100;

  const newBillingAmount = getChargeFromQuarterlyAllIn(newAllIn, newBp, newPlan as PlanKey);

  const { error: upErr } = await supabaseAdmin
    .from('centers')
    .update({
      plan: newPlan,
      subscription_billing_period: newBp,
      billing_period: newBp,
      all_in_price: newAllIn,
      billing_amount: newBillingAmount,
    })
    .eq('id', centerId);

  if (upErr) {
    console.error('[billing/downgrade] center update', upErr);
    return NextResponse.json({ error: 'Failed to apply downgrade' }, { status: 500 });
  }

  if (creditRounded > 0) {
    await earnCredits({
      centerId,
      amount: creditRounded,
      referenceId: randomUUID(),
      referenceType: 'downgrade',
      supabase: supabaseAdmin,
    });
  }

  const newBalance = await getCreditBalance(centerId, supabaseAdmin);

  return NextResponse.json({
    creditEarned: creditRounded,
    newBalance,
    effectiveDate: todayISO(),
  });
}
