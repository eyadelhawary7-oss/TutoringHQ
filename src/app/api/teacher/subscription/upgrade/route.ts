import '@/lib/paymobProductionGuard';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isFeatureEnabled } from '@/lib/features';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';

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
 * Starts a Paymob checkout to move a Standard (teacher_299) teacher to Pro
 * (teacher_699). The webhook finalizes the session (combinedPaymentFinalize,
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
    .select('id, plan_key, status')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const sub = subRow as { id: string; plan_key: string; status: string } | null;
  if (!sub || sub.plan_key !== 'teacher_299' || !['trialing', 'active'].includes(sub.status)) {
    return NextResponse.json({ error: 'NOT_ELIGIBLE' }, { status: 400 });
  }

  // Pro price from platform_config (never hardcoded).
  const { data: configRow, error: configErr } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'teacher_subscription_plan_pro')
    .maybeSingle();
  if (configErr) return fail('plan_config', configErr);
  const plan = ((configRow as { value?: { plan_key?: string; price_gross?: number } } | null)
    ?.value ?? {});
  const priceGross = Number(plan.price_gross ?? 0);
  if (!Number.isFinite(priceGross) || priceGross <= 0) {
    return fail('plan_price', { message: 'teacher_subscription_plan_pro price_gross missing/invalid' });
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

  // combined_payment_sessions has no teacher_id column - the teacher id rides
  // in metadata; center_id is null for teacher sessions.
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: null,
      invoice_ids: [],
      credit_amount: 0,
      paymob_amount: priceGross,
      total_amount: priceGross,
      status: 'pending',
      session_type: 'teacher_upgrade',
      metadata: { teacher_id: auth.userId, plan_key: 'teacher_699' },
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
      merchantOrderId: `teacher-upgrade-${sessionRowId}`,
      itemName: 'CenterHQ Teacher Pro',
      phoneDigits,
      displayName,
    });

    const { error: upErr } = await auth.supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: {
          teacher_id: auth.userId,
          plan_key: 'teacher_699',
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
      amount: priceGross,
    });
  } catch (e) {
    await auth.supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return fail('paymob_checkout', e);
  }
}
