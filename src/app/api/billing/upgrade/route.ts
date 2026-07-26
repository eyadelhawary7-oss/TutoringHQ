import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { canUpgrade, getUpgradeCost } from '@/lib/billingEngine';
import {
  getAnnualChargeRounded,
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { parseBodyWithLimit } from '@/lib/validate';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee, buildInvoiceTaxSnapshot } from '@/lib/processingFee';

export const dynamic = 'force-dynamic';

const PLAN_RANK: Record<string, number> = {
  solo: 1,
  nano: 2,
  starter: 3,
  pro: 4,
  business: 5,
  enterprise: 6,
  top_centers: 7,
};

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { newPlan?: string; newBillingPeriod?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
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

  // Quarterly is retired — the centers billing-period CHECKs only allow
  // monthly/annual, so any legacy/stale client value coerces to monthly here
  // rather than failing at the post-payment finalize write.
  const requestedBp = normalizeBillingPeriod(newBillingPeriodRaw) as BillingPeriod;
  const newBp: BillingPeriod = requestedBp === 'annual' ? 'annual' : 'monthly';
  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, phone, status, billing_status, plan, subscription_billing_period, billing_period, all_in_price, next_payment_due, upgrade_count_this_period, center_code, billing_type, pricing_type',
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
    billing_type?: string | null;
    pricing_type?: string | null;
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

  // Interval changes are NOT upgrades, and they no longer live on this route:
  //   - monthly→annual is chosen at CHECKOUT, not as a mid-cycle upgrade;
  //   - annual→monthly is not an upgrade path at all (it reduces cadence, so it
  //     would have to be SCHEDULED at a renewal boundary, never charged here).
  // Rejecting both here means everything past this point is a same-interval tier
  // upgrade: `newBp === periodForLimit` holds, so the proration below always
  // compares like with like (one daily-rate divisor, not two).
  if (newBp !== periodForLimit) {
    return newBp === 'annual'
      ? NextResponse.json(
          {
            error: 'Switching to annual billing is done at checkout, not as a mid-cycle upgrade.',
            code: 'INTERVAL_SWITCH_AT_CHECKOUT',
            i18nKey: 'billing.upgrade.intervalSwitchAtCheckout',
          },
          { status: 400 },
        )
      : NextResponse.json(
          {
            error: 'Switching from annual to monthly billing is not an upgrade.',
            code: 'INTERVAL_CHANGE_NOT_UPGRADE',
            i18nKey: 'billing.upgrade.intervalChangeNotUpgrade',
          },
          { status: 400 },
        );
  }

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

  const newPlanData = (newPriceRow ?? {}) as {
    all_in_price?: number;
    plan_key?: string;
  };
  const newAllIn = Number(newPlanData.all_in_price ?? 0);
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

  const newPlanFullPeriodPrice = (() => {
    switch (newBp) {
      case 'monthly':
        // Monthly bills at the same per-month rate as quarterly (all_in_price).
        return newAllIn;
      case 'annual':
        return getAnnualChargeRounded(Number(newPlanData.all_in_price));
      default:
        return newAllIn;
    }
  })();

  // Same-interval tier upgrade — the only shape this route serves. Charge the
  // daily-rate difference for the days left in the paid period and keep the
  // existing renewal date (G7).
  const cost = getUpgradeCost({
    newPlanPrice: newPeriodPrice,
    currentPlanPrice: currentPeriodPrice,
    newBillingPeriod: newBp,
    currentBillingPeriod: periodForLimit,
    nextPaymentDue: new Date(`${npd}T12:00:00`),
  });
  const daysRemaining = cost.daysRemaining;
  const dailyRateDifference = cost.dailyRateDifference;
  const cappedProratedCost = Math.min(
    Math.max(0, cost.amountDue),
    Number.isFinite(newPlanFullPeriodPrice) && newPlanFullPeriodPrice > 0
      ? newPlanFullPeriodPrice
      : newPeriodPrice,
  );
  const amountDue = Math.round(cappedProratedCost * 100) / 100;
  if (cappedProratedCost <= 0 || amountDue <= 0) {
    return NextResponse.json(
      {
        error: 'This would not increase your plan cost. Use the Downgrade tab.',
        code: 'USE_DOWNGRADE',
        i18nKey: 'billing.upgrade.useDowngrade',
      },
      { status: 400 },
    );
  }

  // Processing-fee layout (Section 5): the prorated charge is the subscription value;
  // add the flat fee (0 when disabled) to get the amount actually charged via Paymob.
  // No 6% service / 0.5% stamp line — VAT is inside the prorated amount.
  const feeCfg = await getProcessingFeeConfig();
  const { subscription: subscriptionValue, fee: processingFee, total: chargedTotal } =
    applyProcessingFee(amountDue, feeCfg);

  const today = new Date().toISOString().slice(0, 10);
  // A tier upgrade keeps the current renewal date (G7), so the difference invoice
  // covers the remainder of the CURRENT period and ends at npd.
  const invoicePeriodEnd = npd;
  const code = (c.center_code ?? 'XXX').toString().replace(/\s+/g, '') || 'XXX';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const invoiceNumber = `UPG-${code}-${today.slice(0, 7)}-${suffix}`;

  const { data: inv, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      center_id: centerId,
      invoice_number: invoiceNumber,
      invoice_type: 'plan_upgrade_difference',
      total_amount: chargedTotal,
      base_amount: subscriptionValue,
      ...buildInvoiceTaxSnapshot({ total: chargedTotal, fee: processingFee }),
      billing_period_start: today,
      billing_period_end: invoicePeriodEnd,
      due_date: today,
      status: 'pending',
      discount_amount: 0,
      // processing_fee drives the redesigned totals (charge → fee → total, VAT shown
      // as included).
      metadata: { processing_fee: processingFee },
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
      paymob_amount: chargedTotal,
      total_amount: chargedTotal,
      status: 'pending',
      session_type: 'upgrade',
      metadata: {
        newPlan,
        newBillingPeriod: newBp,
        previousPlan: currentPlan,
        previousBillingPeriod: periodForLimit,
        daysRemaining,
        dailyRateDifference,
        amountCharged: chargedTotal,
        processingFee,
        newPlanFullPeriodPrice,
        // A tier upgrade keeps the existing renewal anchor (G7). Finalize records
        // it as upgrade_log.billing_anchor_unchanged and the Paymob webhook uses
        // it for the payment-confirmed WhatsApp period line.
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
      amountEgp: chargedTotal,
      merchantOrderId: `upg-${sessionId}`,
      itemName: 'TutoringHQ plan upgrade',
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
        daysRemaining,
        dailyRateDifference,
        amountDue: subscriptionValue,
        processingFee,
        chargedTotal,
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
