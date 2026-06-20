import '@/lib/paymobProductionGuard';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isFeatureEnabled } from '@/lib/features';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { DEFAULT_TEACHER_PLAN_KEY } from '@/lib/teacherPlans';

const ROUTE_TAG = 'api/teacher/subscription/resubscribe';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/subscription/resubscribe
 * Starts a Paymob checkout for the fixed teacher plan (one plan, no
 * selection; price always from platform_config.teacher_subscription_plan).
 *
 * Sandbox contract: while PAYMOB_ENABLED is false this returns 200
 * { paymob_disabled: true } - the UI renders a "coming soon" card, never an
 * error. Flipping the flag in src/lib/features.ts is the only code change
 * needed to go live (plus migration 20260611000003, which makes
 * combined_payment_sessions.center_id nullable for teacher sessions).
 *
 * The webhook finalizes the session (combinedPaymentFinalize,
 * session_type='teacher_resubscribe') and transitions the subscription to
 * active via apply_teacher_subscription_transition.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  // CORE: current subscription state. Only a lapsed subscription may
  // resubscribe; trialing/active is a no-op rejected up front.
  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('id, status')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const sub = subRow as { id: string; status: string } | null;
  if (sub && (sub.status === 'trialing' || sub.status === 'active')) {
    return NextResponse.json(
      { error: 'Subscription already active', code: 'ALREADY_ACTIVE' },
      { status: 400 },
    );
  }

  // CORE: the plan price. Never hardcoded.
  const { data: configRow, error: configErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'teacher_subscription_plan')
    .maybeSingle();
  if (configErr) return fail('plan_config', configErr);
  const plan = ((configRow as { value?: { plan_key?: string; price_gross?: number } } | null)
    ?.value ?? {});
  const priceGross = Number(plan.price_gross ?? 0);
  if (!Number.isFinite(priceGross) || priceGross <= 0) {
    return fail('plan_price', { message: 'teacher_subscription_plan price_gross missing/invalid' });
  }

  // Sandbox: Paymob is not live yet. Expected state, not an error.
  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return NextResponse.json({ paymob_disabled: true, amount: priceGross });
  }

  // A teacher with no subscription row has nothing to reactivate - their
  // path is the 14-day trial provisioned by the first private group.
  if (!sub) {
    return NextResponse.json(
      { error: 'No subscription to reactivate', code: 'NO_SUBSCRIPTION' },
      { status: 400 },
    );
  }

  // Display info for the Paymob order (best-effort, falls back to defaults).
  const { data: userRow } = await auth.supabaseAdmin
    .from('users')
    .select('name, phone')
    .eq('id', auth.userId)
    .maybeSingle();
  const u = userRow as { name: string | null; phone: string | null } | null;
  const phoneDigits = String(u?.phone ?? '').replace(/\D/g, '') || '0';
  const displayName = (u?.name && u.name.trim()) || 'Teacher';

  // combined_payment_sessions has no teacher_id column (catalog-verified) -
  // the teacher id rides in metadata; center_id is null for teacher sessions.
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: null,
      invoice_ids: [],
      credit_amount: 0,
      paymob_amount: priceGross,
      total_amount: priceGross,
      status: 'pending',
      session_type: 'teacher_resubscribe',
      metadata: { teacher_id: auth.userId, plan_key: plan.plan_key ?? DEFAULT_TEACHER_PLAN_KEY },
    })
    .select('id')
    .single();
  if (insErr || !(inserted as { id?: string } | null)?.id) {
    return fail('session_insert', insErr ?? { message: 'no session id returned' });
  }
  const sessionRowId = (inserted as { id: string }).id;

  try {
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: priceGross,
      merchantOrderId: `teacher-resub-${sessionRowId}`,
      itemName: 'CenterHQ Teacher Subscription',
      phoneDigits,
      displayName,
    });

    const { error: upErr } = await auth.supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: {
          teacher_id: auth.userId,
          plan_key: plan.plan_key ?? DEFAULT_TEACHER_PLAN_KEY,
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
      amount: priceGross,
    });
  } catch (e) {
    await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return fail('paymob_checkout', e);
  }
}
