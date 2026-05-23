import '@/lib/paymobProductionGuard';
import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  getDailyRate,
  getReactivationAmount,
  getReactivationTier,
  isPaygCenter,
} from '@/lib/billingEngine';
import {
  PLANS,
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  type PlanKey,
  type BillingPeriod,
  getChargeFromQuarterlyAllIn,
  normalizeBillingPeriod,
} from '@/lib/pricing';

export const dynamic = 'force-dynamic';

/**
 * Info shown on the standalone /reactivate page: current plan, suspended-tier breakdown,
 * and the catalogue of plans with reactivation totals priced against the centre's current
 * billing period. Auth-gated to suspended owners — never trusts client input for center_id.
 */
export async function GET(request: NextRequest) {
  // allowSuspended: this route only makes sense for a suspended centre, so it
  // opts out of the centerAuth suspension gate.
  const auth = await requireCenterAuth(request, { allowSuspended: true });
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: center, error: cErr } = await auth.supabaseAdmin
    .from('centers')
    .select(
      'id, name, plan, status, billing_status, suspended_at, subscription_billing_period, billing_period, billing_amount, billing_type, pricing_type',
    )
    .eq('id', auth.centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    id: string;
    name?: string | null;
    plan?: string | null;
    status?: string | null;
    billing_status?: string | null;
    suspended_at?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
    billing_amount?: number | null;
    billing_type?: string | null;
    pricing_type?: string | null;
  };

  if (c.status !== 'suspended') {
    return NextResponse.json({ error: 'Center is not suspended' }, { status: 400 });
  }

  if (isPaygCenter(c)) {
    return NextResponse.json(
      { error: 'Pay As You Go centres reactivate via their monthly invoice flow' },
      { status: 400 },
    );
  }

  const suspendedAtRaw = c.suspended_at;
  if (!suspendedAtRaw) {
    return NextResponse.json({ error: 'Missing suspension timestamp' }, { status: 400 });
  }

  const period: BillingPeriod = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  );
  const tier = getReactivationTier(new Date(suspendedAtRaw));
  if (tier === 'tier3') {
    return NextResponse.json(
      { error: 'tier3_requires_support', message: 'Reactivation past tier 2 requires support.' },
      { status: 400 },
    );
  }

  const currentPlanKey =
    (c.plan && Object.prototype.hasOwnProperty.call(PLANS, c.plan)
      ? (c.plan as PlanKey)
      : null) ?? 'starter';

  const plans = ORDERED_SUBSCRIPTION_PLAN_KEYS.map((key) => {
    const planCfg = PLANS[key];
    const periodCharge = getChargeFromQuarterlyAllIn(planCfg.quarterlyAllIn, period, key);
    const dailyRate = getDailyRate(periodCharge, period);
    const calc = getReactivationAmount({
      tier,
      nextPeriodAmount: periodCharge,
      dailyRate,
    });
    return {
      key,
      arabicName: planCfg.arabicName,
      englishName: planCfg.englishName,
      weeklyStudentLimit: planCfg.weeklyStudentLimit,
      nextPeriodAmount: Math.round(periodCharge),
      reactivationTotal: Math.round(calc.total),
      fineOrFee: Math.round(calc.fine + calc.reactivationFee),
      isCurrent: key === currentPlanKey,
    };
  });

  return NextResponse.json({
    center: {
      name: c.name ?? '',
      plan: currentPlanKey,
      billingPeriod: period,
      suspendedAt: suspendedAtRaw,
    },
    tier,
    plans,
  });
}
