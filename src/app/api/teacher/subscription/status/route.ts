import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

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
 * Subscription state for the resubscribe page. Price always comes from
 * platform_config.teacher_subscription_plan, never hardcoded. Both reads are
 * CORE (Rule 151): an error is a 500, never coerced to "no subscription".
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { data: configRow, error: configErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'teacher_subscription_plan')
    .maybeSingle();
  if (configErr) return fail('plan_config', configErr);
  const plan = ((configRow as { value?: PlanConfig } | null)?.value ?? {}) as PlanConfig;
  const priceGross = Number(plan.price_gross ?? 0);
  const planKey = String(plan.plan_key ?? 'teacher_299');

  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select(
      'status, plan_key, trial_ends_at, current_period_end, next_billing_at, grace_until, free_months_credit',
    )
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);

  if (!subRow) {
    return NextResponse.json({
      has_subscription: false,
      status: null,
      plan_key: planKey,
      price_gross: priceGross,
      trial_ends_at: null,
      current_period_end: null,
      next_billing_at: null,
      grace_until: null,
      free_months_credit: 0,
    });
  }

  const sub = subRow as {
    status: string;
    plan_key: string;
    trial_ends_at: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    grace_until: string | null;
    free_months_credit: number | null;
  };

  return NextResponse.json({
    has_subscription: true,
    status: sub.status,
    plan_key: sub.plan_key,
    price_gross: priceGross,
    trial_ends_at: sub.trial_ends_at,
    current_period_end: sub.current_period_end,
    next_billing_at: sub.next_billing_at,
    grace_until: sub.grace_until,
    free_months_credit: Number(sub.free_months_credit ?? 0),
  });
}
