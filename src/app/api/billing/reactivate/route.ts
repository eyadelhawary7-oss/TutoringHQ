import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  getCreditBalance,
  getDailyRate,
  getReactivationAmount,
  getReactivationTier,
  isPaygCenter,
  spendCredits,
} from '@/lib/billingEngine';
import { reactivateCenterFromSession } from '@/lib/combinedPaymentFinalize';
import { normalizeBillingPeriod, type BillingPeriod } from '@/lib/pricing';
import { createPaymobCheckoutEgp, createPaymobIframeForExistingOrder } from '@/lib/paymobCenterCheckout';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // allowSuspended: suspended owners must be able to pay to reactivate.
  const auth = await requireCenterAuth(request, { allowSuspended: true });
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { useCredits?: boolean; creditAmount?: number };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const useCredits = body.useCredits === true;
  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, status, billing_status, suspended_at, subscription_billing_period, billing_period, billing_amount, next_payment_due, phone, center_code, billing_type, pricing_type',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    status?: string;
    billing_status?: string;
    suspended_at?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
    billing_amount?: number | null;
    next_payment_due?: string | null;
    name?: string;
    phone?: string | null;
    center_code?: string | null;
    billing_type?: string | null;
    pricing_type?: string | null;
  };

  if (isPaygCenter(c)) {
    return NextResponse.json(
      { error: 'Pay As You Go reactivation uses your monthly invoice flow' },
      { status: 400 },
    );
  }

  if (c.status !== 'suspended') {
    return NextResponse.json({ error: 'Center is not suspended' }, { status: 400 });
  }

  const suspendedAtRaw = c.suspended_at;
  if (!suspendedAtRaw) {
    return NextResponse.json({ error: 'Missing suspension timestamp' }, { status: 400 });
  }

  const tier = getReactivationTier(new Date(suspendedAtRaw));
  const period = normalizeBillingPeriod(c.subscription_billing_period ?? c.billing_period) as BillingPeriod;
  const nextPeriodAmount = Number(c.billing_amount ?? 0);
  if (!Number.isFinite(nextPeriodAmount) || nextPeriodAmount <= 0) {
    return NextResponse.json({ error: 'Invalid billing amount' }, { status: 400 });
  }

  const dailyRate = getDailyRate(nextPeriodAmount, period, {
    billing_type: c.billing_type,
    pricing_type: c.pricing_type,
  });
  const calc = getReactivationAmount({ tier, nextPeriodAmount, dailyRate });

  const availableCredits = useCredits ? await getCreditBalance(centerId, supabaseAdmin) : 0;
  const requestedCap =
    typeof body.creditAmount === 'number' && Number.isFinite(body.creditAmount)
      ? body.creditAmount
      : availableCredits;
  const creditToApply = useCredits
    ? Math.min(requestedCap, availableCredits, calc.total)
    : 0;
  const paymobAmount = Math.max(0, calc.total - creditToApply);

  const sessionType = tier === 'tier1' ? 'reactivation_tier1' : 'reactivation_tier2';

  if (paymobAmount <= 0) {
    const ref = randomUUID();
    try {
      await spendCredits({
        centerId,
        amount: creditToApply,
        referenceId: ref,
        referenceType: 'subscription',
        supabase: supabaseAdmin,
      });
    } catch {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 400 });
    }
    try {
      await reactivateCenterFromSession(supabaseAdmin, centerId);
    } catch (e) {
      console.error('[billing/reactivate] reactivateCenterFromSession', e);
      return NextResponse.json({ error: 'Failed to reactivate' }, { status: 500 });
    }
    const newBalance = await getCreditBalance(centerId, supabaseAdmin);
    return NextResponse.json({
      reactivated: true,
      breakdown: calc.breakdown,
      newBalance,
    });
  }

  const { data: existingSession, error: existingErr } = await supabaseAdmin
    .from('combined_payment_sessions')
    .select('id, paymob_amount, credit_amount, total_amount, expires_at, paymob_order_id, metadata')
    .eq('center_id', centerId)
    .in('session_type', ['reactivation_tier1', 'reactivation_tier2'])
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!existingErr && existingSession) {
    const ex = existingSession as {
      id: string;
      paymob_amount: number | string;
      credit_amount: number | string | null;
      total_amount: number | string;
      paymob_order_id: string | null;
      metadata: unknown;
    };
    const phone = String(c.phone ?? '').replace(/\D/g, '') || '0';
    const meta: Record<string, unknown> =
      ex.metadata && typeof ex.metadata === 'object' && !Array.isArray(ex.metadata)
        ? { ...(ex.metadata as Record<string, unknown>) }
        : {};
    let paymobUrl: string | null =
      typeof meta.paymob_iframe_url === 'string' ? meta.paymob_iframe_url : null;
    if (!paymobUrl && ex.paymob_order_id) {
      try {
        const refreshed = await createPaymobIframeForExistingOrder({
          paymobOrderId: String(ex.paymob_order_id),
          amountEgp: Number(ex.paymob_amount),
          phoneDigits: phone,
          displayName: String(c.name ?? 'Center'),
        });
        paymobUrl = refreshed.iframeUrl;
        meta.paymob_iframe_url = paymobUrl;
        await supabaseAdmin
          .from('combined_payment_sessions')
          .update({ metadata: meta as never })
          .eq('id', ex.id);
      } catch (e) {
        console.error('[billing/reactivate] refresh iframe for reused session', e);
      }
    }
    return NextResponse.json({
      reused: true,
      sessionId: ex.id,
      paymobUrl: paymobUrl ?? undefined,
      paymobOrderId: ex.paymob_order_id ?? undefined,
      breakdown: calc.breakdown,
      total: Number(ex.total_amount),
      paymobAmount: Number(ex.paymob_amount),
      creditApplied: Number(ex.credit_amount ?? 0),
    });
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: centerId,
      invoice_ids: [],
      credit_amount: creditToApply,
      paymob_amount: paymobAmount,
      total_amount: calc.total,
      status: 'pending',
      session_type: sessionType,
      metadata: { tier, period, nextPeriodAmount },
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    console.error('[billing/reactivate] session insert', insErr);
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }

  const sessionRowId = inserted.id as string;

  try {
    const phone = String(c.phone ?? '').replace(/\D/g, '') || '0';
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: paymobAmount,
      merchantOrderId: `react-${sessionRowId}`,
      itemName: `TutoringHQ reactivation (${sessionType})`,
      phoneDigits: phone,
      displayName: String(c.name ?? 'Center'),
    });

    const { data: metaRow } = await supabaseAdmin
      .from('combined_payment_sessions')
      .select('metadata')
      .eq('id', sessionRowId)
      .maybeSingle();
    const prevMeta: Record<string, unknown> =
      metaRow?.metadata &&
      typeof metaRow.metadata === 'object' &&
      !Array.isArray(metaRow.metadata)
        ? { ...(metaRow.metadata as Record<string, unknown>) }
        : { tier, period, nextPeriodAmount };
    prevMeta.paymob_iframe_url = checkout.iframeUrl;

    const { error: upErr } = await supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: prevMeta as never,
      })
      .eq('id', sessionRowId);

    if (upErr) {
      console.error('[billing/reactivate] session paymob id', upErr);
      return NextResponse.json({ error: 'Failed to link Paymob order' }, { status: 500 });
    }

    return NextResponse.json({
      paymobUrl: checkout.iframeUrl,
      paymobOrderId: checkout.paymobOrderId,
      sessionId: sessionRowId,
      breakdown: calc.breakdown,
      total: calc.total,
      paymobAmount,
      creditApplied: creditToApply,
    });
  } catch (e) {
    console.error('[billing/reactivate] paymob', e);
    await supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payment setup failed' },
      { status: 500 },
    );
  }
}
