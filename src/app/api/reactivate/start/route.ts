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
  isPlanKey,
  type BillingPeriod,
  type PlanKey,
  getChargeFromQuarterlyAllIn,
  normalizeBillingPeriod,
} from '@/lib/pricing';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * Standalone-reactivation paymob initiator used by the /[locale]/reactivate page.
 * Caller picks a plan; if it differs from the centre's current plan, the centre row is
 * promoted to the new plan before the Paymob session is created (post-payment the
 * webhook reactivates with the new billing_amount already in place).
 *
 * Center id is derived from the session — never from request body.
 */
export async function POST(request: NextRequest) {
  // allowSuspended: suspended owners must be able to pay to reactivate.
  const auth = await requireCenterAuth(request, { allowSuspended: true });
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { plan?: unknown };
  try {
    body = (await parseBodyWithLimit(request, 4096)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const selectedPlanRaw = typeof body.plan === 'string' ? body.plan : '';
  if (!isPlanKey(selectedPlanRaw) || selectedPlanRaw === 'top_centers') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  const selectedPlan = selectedPlanRaw as Exclude<PlanKey, 'top_centers'>;

  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, plan, status, suspended_at, subscription_billing_period, billing_period, billing_amount, all_in_price, phone, billing_type, pricing_type',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    id: string;
    name?: string | null;
    plan?: string | null;
    status?: string | null;
    suspended_at?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
    billing_amount?: number | null;
    all_in_price?: number | null;
    phone?: string | null;
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
  if (!c.suspended_at) {
    return NextResponse.json({ error: 'Missing suspension timestamp' }, { status: 400 });
  }

  const period: BillingPeriod = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  );
  const tier = getReactivationTier(new Date(c.suspended_at));
  if (tier === 'tier3') {
    return NextResponse.json(
      { error: 'tier3_requires_support', message: 'Reactivation past tier 2 requires support.' },
      { status: 400 },
    );
  }

  const planCfg = PLANS[selectedPlan];
  const periodCharge = getChargeFromQuarterlyAllIn(planCfg.quarterlyAllIn, period, selectedPlan);
  if (!Number.isFinite(periodCharge) || periodCharge <= 0) {
    return NextResponse.json({ error: 'Invalid pricing for plan' }, { status: 400 });
  }
  const dailyRate = getDailyRate(periodCharge, period);
  const calc = getReactivationAmount({
    tier,
    nextPeriodAmount: periodCharge,
    dailyRate,
  });
  const paymobAmount = Math.round(calc.total);
  if (paymobAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  const planChanged = c.plan !== selectedPlan;
  if (planChanged) {
    const { error: upErr } = await supabaseAdmin
      .from('centers')
      .update({
        plan: selectedPlan,
        all_in_price: planCfg.quarterlyAllIn,
        billing_amount: Math.round(periodCharge),
      })
      .eq('id', centerId)
      .eq('status', 'suspended');
    if (upErr) {
      console.error('[reactivate/start] plan promote', upErr);
      return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
    }
  }

  const sessionType = tier === 'tier1' ? 'reactivation_tier1' : 'reactivation_tier2';

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: centerId,
      invoice_ids: [],
      credit_amount: 0,
      paymob_amount: paymobAmount,
      total_amount: paymobAmount,
      status: 'pending',
      session_type: sessionType,
      metadata: {
        tier,
        period,
        plan: selectedPlan,
        nextPeriodAmount: Math.round(periodCharge),
        source: 'standalone_reactivation',
        breakdown: calc.breakdown,
      },
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    console.error('[reactivate/start] session insert', insErr);
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }

  const sessionRowId = inserted.id as string;
  const phone = String(c.phone ?? '').replace(/\D/g, '') || '0';

  try {
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: paymobAmount,
      merchantOrderId: `react-${sessionRowId}`,
      itemName: `CenterHQ reactivation (${sessionType})`,
      phoneDigits: phone,
      displayName: String(c.name ?? 'Center'),
    });

    const { data: metaRow } = await supabaseAdmin
      .from('combined_payment_sessions')
      .select('metadata')
      .eq('id', sessionRowId)
      .maybeSingle();
    const prevMeta: Record<string, unknown> =
      metaRow?.metadata && typeof metaRow.metadata === 'object' && !Array.isArray(metaRow.metadata)
        ? { ...(metaRow.metadata as Record<string, unknown>) }
        : {};
    prevMeta.paymob_iframe_url = checkout.iframeUrl;

    const { error: upErr } = await supabaseAdmin
      .from('combined_payment_sessions')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        metadata: prevMeta as never,
      })
      .eq('id', sessionRowId);

    if (upErr) {
      console.error('[reactivate/start] session paymob id', upErr);
      return NextResponse.json({ error: 'Failed to link Paymob order' }, { status: 500 });
    }

    return NextResponse.json({
      paymobUrl: checkout.iframeUrl,
      paymobOrderId: checkout.paymobOrderId,
      sessionId: sessionRowId,
      total: paymobAmount,
      tier,
      plan: selectedPlan,
    });
  } catch (e) {
    console.error('[reactivate/start] paymob', e);
    await supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionRowId);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payment setup failed' },
      { status: 500 },
    );
  }
}
