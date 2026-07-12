import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isFeatureEnabled } from '@/lib/features';
import { DEFAULT_TEACHER_PLAN_KEY, getTeacherPlan } from '@/lib/teacherPlans';
import { getIntervalConfig } from '@/lib/pricingConfig';
import { ownerHasEverPaidInvoice, teacherHasExportAccess } from '@/lib/exportEntitlement';

const ROUTE_TAG = 'api/teacher/subscription/status';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

type PlanConfig = {
  plan_key?: string;
  price_gross?: number;
};

/**
 * GET /api/teacher/subscription/status
 * Subscription state for the resubscribe + billing pages. Prices always come
 * from platform_config (teacher_subscription_plan / _pro), never hardcoded.
 * Both subscription + profile reads are CORE (Rule 151): an error is a 500,
 * never coerced to "no subscription".
 *
 * Blast credits live on teacher_profiles (two buckets); plan/status/period
 * live on teacher_subscriptions.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { data: stdRow, error: stdErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'teacher_subscription_plan')
    .maybeSingle();
  if (stdErr) return fail('plan_config', stdErr);
  const { data: proRow, error: proErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'teacher_subscription_plan_pro')
    .maybeSingle();
  if (proErr) return fail('plan_config_pro', proErr);
  const stdPlan = ((stdRow as { value?: PlanConfig } | null)?.value ?? {}) as PlanConfig;
  const proPlan = ((proRow as { value?: PlanConfig } | null)?.value ?? {}) as PlanConfig;
  const stdPrice = Number(stdPlan.price_gross ?? 0);
  const proPrice = Number(proPlan.price_gross ?? 0);
  const defaultPlanKey = String(stdPlan.plan_key ?? DEFAULT_TEACHER_PLAN_KEY);

  const { data: profileRow, error: profileErr } = await auth.supabaseAdmin
    .from('teacher_profiles')
    .select('blast_credits_purchased, blast_credits_subscription')
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (profileErr) return fail('profile_lookup', profileErr);
  const profile = (profileRow as {
    blast_credits_purchased: number | null;
    blast_credits_subscription: number | null;
  } | null) ?? { blast_credits_purchased: 0, blast_credits_subscription: 0 };
  const blastPurchased = Number(profile.blast_credits_purchased ?? 0);
  const blastSubscription = Number(profile.blast_credits_subscription ?? 0);

  // Whether the upgrade CTA can do anything. The UI swaps the button for a
  // visible "payments unavailable" banner when this is false (no dead buttons).
  const paymentsEnabled = isFeatureEnabled('PAYMOB_ENABLED');

  // Shared annual multiplier (=10). The UI derives annual = price_gross × this,
  // and the resubscribe checkout charges with the SAME value, so shown == charged.
  let annualMultiplier = 10;
  try {
    annualMultiplier = (await getIntervalConfig()).annualMultiplier;
  } catch {
    annualMultiplier = 10;
  }

  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select(
      'status, plan_key, trial_ends_at, current_period_start, current_period_end, next_billing_at, grace_until, free_months_credit, billing_interval',
    )
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);

  if (!subRow) {
    return NextResponse.json({
      has_subscription: false,
      status: null,
      // W4: no subscription → not trialing → export ungated (unreachable path in
      // practice, since private surfaces require an active/trialing subscription).
      export_access: true,
      plan_key: defaultPlanKey,
      price_gross: stdPrice,
      std_price_gross: stdPrice,
      pro_price_gross: proPrice,
      payments_enabled: paymentsEnabled,
      trial_ends_at: null,
      current_period_start: null,
      current_period_end: null,
      next_billing_at: null,
      grace_until: null,
      free_months_credit: 0,
      blast_credits_purchased: blastPurchased,
      blast_credits_subscription: blastSubscription,
      annual_multiplier: annualMultiplier,
      billing_interval: 'monthly',
    });
  }

  const sub = subRow as {
    status: string;
    plan_key: string;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    grace_until: string | null;
    free_months_credit: number | null;
    billing_interval: string | null;
  };

  // Std/Pro prices come from platform_config; any other tier (e.g. Scale) reads
  // the source-of-truth module price.
  const priceGross =
    getTeacherPlan(sub.plan_key).rank === 1
      ? stdPrice
      : sub.plan_key === 'teacher_pro'
        ? proPrice
        : getTeacherPlan(sub.plan_key).priceGross;

  // W4 export entitlement: CUSTOMER income export is paid-only during trial. Probe
  // paid invoices only while trialing (active is already ungated) so an existing
  // payer swept into a trial is never gated.
  let teacherHasEverPaid = false;
  if (sub.status === 'trialing') {
    teacherHasEverPaid = await ownerHasEverPaidInvoice(auth.supabaseAdmin, {
      ownerType: 'teacher',
      teacherId: auth.userId,
    });
  }
  const exportAccess = teacherHasExportAccess({
    subscriptionStatus: sub.status,
    hasEverPaid: teacherHasEverPaid,
  });

  return NextResponse.json({
    has_subscription: true,
    status: sub.status,
    export_access: exportAccess,
    plan_key: sub.plan_key,
    price_gross: priceGross,
    std_price_gross: stdPrice,
    pro_price_gross: proPrice,
    payments_enabled: paymentsEnabled,
    trial_ends_at: sub.trial_ends_at,
    current_period_start: sub.current_period_start,
    current_period_end: sub.current_period_end,
    next_billing_at: sub.next_billing_at,
    grace_until: sub.grace_until,
    free_months_credit: Number(sub.free_months_credit ?? 0),
    blast_credits_purchased: blastPurchased,
    blast_credits_subscription: blastSubscription,
    annual_multiplier: annualMultiplier,
    billing_interval: sub.billing_interval === 'annual' ? 'annual' : 'monthly',
  });
}
