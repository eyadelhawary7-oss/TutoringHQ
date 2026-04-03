import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { canUpgrade, getUpgradeCost } from '@/lib/billingEngine';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';

export const dynamic = 'force-dynamic';

const PLAN_RANK: Record<string, number> = {
  nano: 1,
  starter: 2,
  pro: 3,
  business: 4,
  enterprise: 5,
  top_centers: 6,
};

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { newPlan?: string; newBillingPeriod?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const newPlan = typeof body.newPlan === 'string' ? body.newPlan.trim() : '';
  const newBillingPeriodRaw =
    typeof body.newBillingPeriod === 'string' ? body.newBillingPeriod.trim() : '';

  if (!newPlan || !newBillingPeriodRaw) {
    return NextResponse.json({ error: 'newPlan and newBillingPeriod required' }, { status: 400 });
  }

  if (newPlan === 'top_centers') {
    return NextResponse.json({ error: 'Top Centers requires manual approval' }, { status: 400 });
  }

  if (!isPlanKey(newPlan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const newBp = normalizeBillingPeriod(newBillingPeriodRaw) as BillingPeriod;
  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, phone, status, billing_status, plan, subscription_billing_period, billing_period, all_in_price, next_payment_due, upgrade_count_this_period, center_code',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    status?: string;
    billing_status?: string;
    plan?: string;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
    all_in_price?: number | null;
    next_payment_due?: string | null;
    upgrade_count_this_period?: number | null;
    name?: string;
    phone?: string | null;
    center_code?: string | null;
  };

  if (c.status !== 'active') {
    return NextResponse.json({ error: 'Center must be active' }, { status: 400 });
  }

  const bs = c.billing_status ?? '';
  if (bs !== 'paid' && bs !== 'active') {
    return NextResponse.json({ error: 'Billing must be paid or active' }, { status: 400 });
  }

  const currentPlan = c.plan ?? 'starter';
  const currentRank = PLAN_RANK[currentPlan] ?? 1;
  const requestedRank = PLAN_RANK[newPlan] ?? 0;

  const periodForLimit = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  ) as BillingPeriod;

  const gate = canUpgrade({
    currentPlanRank: currentRank,
    requestedPlanRank: requestedRank,
    upgradeCountThisPeriod: Number(c.upgrade_count_this_period ?? 0),
    billingPeriod: periodForLimit,
  });

  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason ?? 'Upgrade not allowed' }, { status: 400 });
  }

  const npd = c.next_payment_due?.slice(0, 10);
  if (!npd) {
    return NextResponse.json({ error: 'Missing next payment due' }, { status: 400 });
  }

  const { data: newPriceRow } = await supabaseAdmin
    .from('pricing_plans')
    .select('all_in_price, plan_key')
    .eq('plan_key', newPlan)
    .eq('is_active', true)
    .maybeSingle();

  const newAllIn = Number((newPriceRow as { all_in_price?: number } | null)?.all_in_price ?? 0);
  if (!Number.isFinite(newAllIn) || newAllIn <= 0) {
    return NextResponse.json({ error: 'Plan pricing unavailable' }, { status: 400 });
  }

  const currentPk = isPlanKey(currentPlan) ? currentPlan : 'starter';
  const currentAllIn =
    Number(c.all_in_price ?? 0) ||
    (PLANS[currentPk as PlanKey]?.quarterlyAllIn ?? PLANS.starter.quarterlyAllIn);
  const currentPeriodPrice = getChargeFromQuarterlyAllIn(
    currentAllIn,
    periodForLimit,
    currentPk as PlanKey,
  );
  const newPeriodPrice = getChargeFromQuarterlyAllIn(newAllIn, newBp, newPlan as PlanKey);

  const cost = getUpgradeCost({
    newPlanPrice: newPeriodPrice,
    currentPlanPrice: currentPeriodPrice,
    newBillingPeriod: newBp,
    currentBillingPeriod: periodForLimit,
    nextPaymentDue: new Date(`${npd}T12:00:00`),
  });

  const amountDue = Math.round(cost.amountDue * 100) / 100;
  if (amountDue <= 0) {
    return NextResponse.json({ error: 'No amount due for upgrade' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const code = (c.center_code ?? 'XXX').toString().replace(/\s+/g, '') || 'XXX';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const invoiceNumber = `UPG-${code}-${today.slice(0, 7)}-${suffix}`;

  const { data: inv, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      center_id: centerId,
      invoice_number: invoiceNumber,
      invoice_type: 'plan_upgrade_difference',
      total_amount: amountDue,
      base_amount: amountDue,
      billing_period_start: today,
      billing_period_end: npd,
      due_date: today,
      status: 'pending',
      discount_amount: 0,
    })
    .select('id')
    .single();

  if (invErr || !inv?.id) {
    console.error('[billing/upgrade] invoice', invErr);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }

  const invoiceId = inv.id as string;

  const { data: sess, error: sErr } = await supabaseAdmin
    .from('combined_payment_sessions')
    .insert({
      center_id: centerId,
      invoice_ids: [invoiceId],
      credit_amount: 0,
      paymob_amount: amountDue,
      total_amount: amountDue,
      status: 'pending',
      session_type: 'upgrade',
      metadata: {
        newPlan,
        newBillingPeriod: newBp,
        previousPlan: currentPlan,
        previousBillingPeriod: periodForLimit,
        daysRemaining: cost.daysRemaining,
        dailyRateDifference: cost.dailyRateDifference,
        amountCharged: amountDue,
        billingAnchorYmd: npd,
      },
    })
    .select('id')
    .single();

  if (sErr || !sess?.id) {
    await supabaseAdmin.from('invoices').delete().eq('id', invoiceId);
    console.error('[billing/upgrade] session', sErr);
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }

  const sessionId = sess.id as string;

  try {
    const phone = String(c.phone ?? '').replace(/\D/g, '') || '0';
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: amountDue,
      merchantOrderId: `upg-${sessionId}`,
      itemName: 'CenterHQ plan upgrade',
      phoneDigits: phone,
      displayName: String(c.name ?? 'Center'),
    });

    await supabaseAdmin
      .from('invoices')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        paymob_iframe_url: checkout.iframeUrl,
      })
      .eq('id', invoiceId)
      .eq('center_id', centerId);

    await supabaseAdmin
      .from('combined_payment_sessions')
      .update({ paymob_order_id: checkout.paymobOrderId })
      .eq('id', sessionId);

    return NextResponse.json({
      paymobUrl: checkout.iframeUrl,
      paymobOrderId: checkout.paymobOrderId,
      sessionId,
      invoiceId,
      breakdown: {
        daysRemaining: cost.daysRemaining,
        dailyRateDifference: cost.dailyRateDifference,
        amountDue,
      },
      newNextPaymentDue: npd,
      upgrade_count_this_period: Number(c.upgrade_count_this_period ?? 0),
    });
  } catch (e) {
    await supabaseAdmin.from('combined_payment_sessions').delete().eq('id', sessionId);
    await supabaseAdmin.from('invoices').delete().eq('id', invoiceId);
    console.error('[billing/upgrade] paymob', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payment setup failed' },
      { status: 500 },
    );
  }
}
