import '@/lib/paymobProductionGuard';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isFeatureEnabled } from '@/lib/features';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { DEFAULT_TEACHER_PLAN_KEY, teacherPlanConfigKey } from '@/lib/teacherPlans';
import { getIntervalConfig, getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee } from '@/lib/processingFee';
import { getAnnualChargeRounded } from '@/lib/pricing';
import { getSwitchToAnnualCharge } from '@/lib/billingEngine';
import { getSummerConfig, summerHoldsCharges } from '@/lib/summer/config';

const ROUTE_TAG = 'api/teacher/subscription/switch-interval';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/subscription/switch-interval  { interval: 'monthly' | 'annual' }
 *
 * Makes annual REACHABLE for normal teachers (the resubscribe flow only covered
 * lapsed subs). Behaviour by current state:
 *
 *   - trialing  → store billing_interval; NO charge. The first post-trial charge
 *     then bills the chosen cadence (the recurring engine already honours it).
 *   - active, monthly → annual → charge the FULL annual base (price_gross × the
 *     shared annual_multiplier =10) + fee now, then flip to a 12-month cycle. The
 *     paid session reuses the existing 'teacher_resubscribe' finalize, which sets
 *     billing_interval='annual' + the 12-month period (and is a no-op transition
 *     when already active). NOTE: centers have no usable monthly→annual switch to
 *     mirror (their proration yields ≤0 for a cheaper-per-day annual), so we follow
 *     the brief's assumption: charge the annual base at switch, annual renewal.
 *   - active, annual → monthly → store 'monthly'; takes effect at the next renewal,
 *     no charge/refund.
 *
 * Inert while Paymob-teacher is OFF: the annual charge returns { paymob_disabled }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  let interval: 'monthly' | 'annual' = 'monthly';
  try {
    const body = (await request.json().catch(() => ({}))) as { interval?: unknown };
    interval = body.interval === 'annual' ? 'annual' : 'monthly';
  } catch {
    interval = 'monthly';
  }

  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('id, status, plan_key, billing_interval, current_period_end')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const sub = subRow as
    | {
        id: string;
        status: string;
        plan_key: string | null;
        billing_interval: string | null;
        current_period_end: string | null;
      }
    | null;
  if (!sub) {
    return NextResponse.json({ error: 'No subscription', code: 'NO_SUBSCRIPTION' }, { status: 400 });
  }

  const current = sub.billing_interval === 'annual' ? 'annual' : 'monthly';
  if (current === interval) {
    return NextResponse.json({ ok: true, interval, applied: 'noop' });
  }

  // Trialing, or any switch that does not require an immediate charge (annual→monthly),
  // is a plain preference write — the next charge bills the new cadence.
  const isTrial = sub.status === 'trialing';
  if (isTrial || interval === 'monthly') {
    const { error: upErr } = await auth.supabaseAdmin
      .from('teacher_subscriptions')
      .update({ billing_interval: interval })
      .eq('id', sub.id);
    if (upErr) return fail('interval_write', upErr);
    return NextResponse.json({ ok: true, interval, applied: isTrial ? 'trial' : 'next_renewal' });
  }

  // Active monthly → annual: charge the annual base now.
  if (sub.status !== 'active') {
    return NextResponse.json(
      { error: 'Subscription not active', code: 'NOT_ACTIVE' },
      { status: 400 },
    );
  }

  const planConfigKey = teacherPlanConfigKey(sub.plan_key ?? DEFAULT_TEACHER_PLAN_KEY);
  const { data: configRow, error: configErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', planConfigKey)
    .maybeSingle();
  if (configErr) return fail('plan_config', configErr);
  const plan = ((configRow as { value?: { plan_key?: string; price_gross?: number } } | null)
    ?.value ?? {});
  const monthlyGross = Number(plan.price_gross ?? 0);
  if (!Number.isFinite(monthlyGross) || monthlyGross <= 0) {
    return fail('plan_price', { message: `${planConfigKey} price_gross missing/invalid` });
  }

  const { annualMultiplier } = await getIntervalConfig();
  // Prorated pay-now (rule 2): annual full price minus credit for the unused part of
  // the current monthly period; a fresh 12-month term starts now. G9: no credit while
  // summer holds charges. The credit only reduces the charge, never a balance (G3/G4).
  const annualFullPrice = getAnnualChargeRounded(monthlyGross, annualMultiplier);
  const summerCfg = await getSummerConfig();
  const periodEndDate = sub.current_period_end
    ? new Date(sub.current_period_end)
    : new Date(); // no current period → 0 days remaining → no credit
  const sw = getSwitchToAnnualCharge({
    annualFullPrice,
    currentPeriodPrice: monthlyGross,
    currentBillingPeriod: 'monthly',
    nextPaymentDue: periodEndDate,
    summerHoldsCharges: summerHoldsCharges(summerCfg),
  });
  const subscriptionAmount = sw.charge;
  const feeCfg = await getProcessingFeeConfig();
  const { fee: processingFee, total: chargedTotal } = applyProcessingFee(subscriptionAmount, feeCfg);

  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return NextResponse.json({ paymob_disabled: true, amount: chargedTotal, interval: 'annual' });
  }

  const { data: userRow } = await auth.supabaseAdmin
    .from('users')
    .select('name, phone')
    .eq('id', auth.userId)
    .maybeSingle();
  const u = userRow as { name: string | null; phone: string | null } | null;
  const phoneDigits = String(u?.phone ?? '').replace(/\D/g, '') || '0';
  const displayName = (u?.name && u.name.trim()) || 'Teacher';

  // Reuse the 'teacher_resubscribe' session_type: its finalize sets
  // billing_interval + the (12-month, annual) period from metadata and no-ops the
  // status transition when the sub is already active.
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: null,
      invoice_ids: [],
      credit_amount: 0,
      paymob_amount: chargedTotal,
      total_amount: chargedTotal,
      status: 'pending',
      session_type: 'teacher_resubscribe',
      metadata: {
        teacher_id: auth.userId,
        plan_key: plan.plan_key ?? sub.plan_key ?? DEFAULT_TEACHER_PLAN_KEY,
        billing_interval: 'annual',
        subscription_amount: subscriptionAmount,
        processing_fee: processingFee,
      },
    })
    .select('id')
    .single();
  if (insErr || !(inserted as { id?: string } | null)?.id) {
    return fail('session_insert', insErr ?? { message: 'no session id returned' });
  }
  const sessionRowId = (inserted as { id: string }).id;

  try {
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: chargedTotal,
      merchantOrderId: `teacher-switch-${sessionRowId}`,
      itemName: 'TutoringHQ Teacher Subscription (Annual)',
      phoneDigits,
      displayName,
    });
    const { error: upErr } = await auth.supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: {
          teacher_id: auth.userId,
          plan_key: plan.plan_key ?? sub.plan_key ?? DEFAULT_TEACHER_PLAN_KEY,
          billing_interval: 'annual',
          subscription_amount: subscriptionAmount,
          processing_fee: processingFee,
          paymob_iframe_url: checkout.iframeUrl,
        } as never,
      })
      .eq('id', sessionRowId);
    if (upErr) {
      await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
      return fail('session_link_order', upErr);
    }
    return NextResponse.json({
      paymob_url: checkout.iframeUrl,
      session_id: sessionRowId,
      amount: chargedTotal,
      interval: 'annual',
    });
  } catch (e) {
    await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return fail('paymob_checkout', e);
  }
}
