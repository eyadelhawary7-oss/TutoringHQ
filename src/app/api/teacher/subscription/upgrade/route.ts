import '@/lib/paymobProductionGuard';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isFeatureEnabled } from '@/lib/features';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { getTeacherPlan } from '@/lib/teacherPlans';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee } from '@/lib/processingFee';
import { getUpgradeCost } from '@/lib/billingEngine';

const ROUTE_TAG = 'api/teacher/subscription/upgrade';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/subscription/upgrade
 * Starts a Paymob checkout to move a Standard (teacher_standard) teacher to Pro
 * (teacher_pro). The webhook finalizes the session (combinedPaymentFinalize,
 * session_type='teacher_upgrade') and calls upgrade_teacher_to_pro.
 *
 * PAYMOB gate (Rule, hard): when PAYMOB_ENABLED is off this returns 503
 * { error: 'PAYMENTS_UNAVAILABLE' } - no hidden buttons, the UI shows a visible
 * "payments unavailable" message instead of a checkout. The single source of
 * truth is isFeatureEnabled('PAYMOB_ENABLED') (env-backed via src/lib/features).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  // Hard gate: payments off -> 503, never a silent partial flow.
  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return NextResponse.json({ error: 'PAYMENTS_UNAVAILABLE' }, { status: 503 });
  }

  // Eligibility: only a Standard teacher on a live (trialing/active)
  // subscription may upgrade. plan_key/status are catalog-verified to live on
  // teacher_subscriptions (NOT teacher_profiles).
  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('id, plan_key, status, current_period_end')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const sub = subRow as
    | { id: string; plan_key: string; status: string; current_period_end: string | null }
    | null;
  if (
    !sub ||
    getTeacherPlan(sub.plan_key).rank !== 1 ||
    !['trialing', 'active'].includes(sub.status)
  ) {
    return NextResponse.json({ error: 'NOT_ELIGIBLE' }, { status: 400 });
  }

  // Std + Pro prices from platform_config (never hardcoded).
  const { data: cfgRows, error: configErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('key, value')
    .in('key', ['teacher_subscription_plan', 'teacher_subscription_plan_pro']);
  if (configErr) return fail('plan_config', configErr);
  const cfgMap = new Map(
    ((cfgRows as { key: string; value?: { price_gross?: number } }[] | null) ?? []).map((r) => [
      r.key,
      Number(r.value?.price_gross ?? 0),
    ]),
  );
  const proGross = cfgMap.get('teacher_subscription_plan_pro') ?? 0;
  const stdGross = cfgMap.get('teacher_subscription_plan') ?? 0;
  if (!Number.isFinite(proGross) || proGross <= 0) {
    return fail('plan_price', { message: 'teacher_subscription_plan_pro price_gross missing/invalid' });
  }

  // Unified rule 1: an ACTIVE teacher pays only the prorated difference for the days
  // left in the current paid month (Std→Pro), and the renewal date is kept (G7 — the
  // RPC no longer resets the period). A TRIALING teacher has no paid time to credit
  // (G3), so they start a fresh paid Pro month at the full Pro price.
  const isTrialing = sub.status === 'trialing';
  let subscriptionAmount: number;
  if (isTrialing) {
    subscriptionAmount = proGross;
  } else {
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : new Date();
    const { amountDue } = getUpgradeCost({
      newPlanPrice: proGross,
      currentPlanPrice: stdGross,
      newBillingPeriod: 'monthly',
      currentBillingPeriod: 'monthly',
      nextPaymentDue: periodEnd,
    });
    subscriptionAmount = Math.round(Math.max(0, amountDue) * 100) / 100;
    if (subscriptionAmount <= 0) {
      return NextResponse.json({ error: 'NO_CHARGE', code: 'NO_CHARGE' }, { status: 400 });
    }
  }
  const priceGross = subscriptionAmount;

  // Flat processing fee (Section 5) added on top of the (prorated) upgrade charge.
  const feeCfg = await getProcessingFeeConfig();
  const { fee: processingFee, total: chargedTotal } = applyProcessingFee(priceGross, feeCfg);

  // Display info for the Paymob order (best-effort, falls back to defaults).
  const { data: userRow } = await auth.supabaseAdmin
    .from('users')
    .select('name, phone')
    .eq('id', auth.userId)
    .maybeSingle();
  const u = userRow as { name: string | null; phone: string | null } | null;
  const phoneDigits = String(u?.phone ?? '').replace(/\D/g, '') || '0';
  const displayName = (u?.name && u.name.trim()) || 'Teacher';

  // combined_payment_sessions has no teacher_id column - the teacher id rides
  // in metadata; center_id is null for teacher sessions.
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: null,
      invoice_ids: [],
      credit_amount: 0,
      paymob_amount: chargedTotal,
      total_amount: chargedTotal,
      status: 'pending',
      session_type: 'teacher_upgrade',
      metadata: {
        teacher_id: auth.userId,
        plan_key: 'teacher_pro',
        subscription_amount: priceGross,
        processing_fee: processingFee,
        freshProPeriod: isTrialing,
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
      merchantOrderId: `teacher-upgrade-${sessionRowId}`,
      itemName: 'TutoringHQ Teacher Pro',
      phoneDigits,
      displayName,
    });

    const { error: upErr } = await auth.supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: {
          teacher_id: auth.userId,
          plan_key: 'teacher_pro',
          subscription_amount: priceGross,
          processing_fee: processingFee,
          freshProPeriod: isTrialing,
          paymob_iframe_url: checkout.iframeUrl,
        } as never,
      })
      .eq('id', sessionRowId);
    if (upErr) {
      await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
      return fail('session_link_order', upErr);
    }

    return NextResponse.json({
      checkout_url: checkout.iframeUrl,
      session_id: sessionRowId,
      amount: chargedTotal,
    });
  } catch (e) {
    await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return fail('paymob_checkout', e);
  }
}
