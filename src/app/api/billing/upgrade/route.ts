import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { checkUpgradeRankGate, getUpgradeLimit, getUpgradeCost } from '@/lib/billingEngine';
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
import { validateCSRFRequest } from '@/lib/csrf';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee, buildInvoiceTaxSnapshot } from '@/lib/processingFee';
import { repriceSubscriptionInvoice } from '@/lib/repriceSubscriptionInvoice';
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { centerRenewalPeriodMonths } from '@/lib/centerRenewal';

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

/**
 * Mint a Paymob checkout for a specific invoice and attach it: paymob_order_id,
 * paymob_iframe_url, and a metadata.paymob_cached_total snapshot (the amount
 * this checkout was minted for). That snapshot is what /api/invoices/[id]/pay's
 * cache-reuse guard compares against the invoice's CURRENT total before ever
 * reusing a cached checkout — so a subsequent reprice (a plan change, a fee
 * change) can never hand back a stale iframe for the wrong amount.
 */
async function mintCheckoutForInvoice(
  supabaseAdmin: SupabaseClient,
  params: {
    invoiceId: string;
    centerId: string;
    amountEgp: number;
    merchantOrderIdPrefix: string;
    phoneDigits: string;
    displayName: string;
    existingMetadata: Record<string, unknown>;
  },
): Promise<{ paymobOrderId: string; iframeUrl: string }> {
  const checkout = await createPaymobCheckoutEgp({
    amountEgp: params.amountEgp,
    merchantOrderId: `${params.merchantOrderIdPrefix}-${params.invoiceId}`,
    itemName: 'TutoringHQ plan upgrade',
    phoneDigits: params.phoneDigits,
    displayName: params.displayName,
  });

  await supabaseAdmin
    .from('invoices')
    .update({
      paymob_order_id: checkout.paymobOrderId,
      paymob_iframe_url: checkout.iframeUrl,
      metadata: { ...params.existingMetadata, paymob_cached_total: params.amountEgp },
    })
    .eq('id', params.invoiceId)
    .eq('center_id', params.centerId);

  return checkout;
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // S8: this route charges the center via Paymob (a plan upgrade) and had no
  // CSRF check at all. Matches the pattern already used by billing/cancel
  // and billing/withdrawal.
  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
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

  // Rank gate only, here — no quota yet. The quota only makes sense once we
  // know whether this is a mid-cycle upgrade (quota applies) or a day-zero
  // upgrade (the period is rolling over anyway, so the quota resets with it —
  // see below, once daysRemaining is known).
  const rankGate = checkUpgradeRankGate({
    currentPlanRank: currentRank,
    requestedPlanRank: requestedRank,
  });
  if (!rankGate.allowed) {
    return NextResponse.json({ error: rankGate.reason ?? 'Upgrade not allowed' }, { status: 400 });
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

  // Full one-cycle price of the new tier — the day-zero charge in full, and
  // (same-interval only, since interval switching left this route in PR 1) an
  // upper bound on the mid-cycle proration below.
  const newPlanFullPeriodPrice =
    newBp === 'annual' ? getAnnualChargeRounded(Number(newPlanData.all_in_price)) : newAllIn;

  const cost = getUpgradeCost({
    newPlanPrice: newPeriodPrice,
    currentPlanPrice: currentPeriodPrice,
    newBillingPeriod: newBp,
    currentBillingPeriod: periodForLimit,
    nextPaymentDue: new Date(`${npd}T12:00:00`),
  });
  const daysRemaining = cost.daysRemaining;
  const dailyRateDifference = cost.dailyRateDifference;

  const phone = String(c.phone ?? '').replace(/\D/g, '') || '0';
  const displayName = String(c.name ?? 'Center');
  const code = (c.center_code ?? 'XXX').toString().replace(/\s+/g, '') || 'XXX';

  // ── Day zero: on or after next_payment_due, the upgrade IS the renewal ──
  // No separate proration charge. Reprice (or create) the pending renewal
  // invoice to the new tier's full period price and schedule the plan change
  // for when that invoice is paid — the SAME mechanism the downgrade route
  // uses (scheduledPlanChange.ts is direction-agnostic; a plain column write
  // is naturally last-write-wins, whichever direction the customer most
  // recently asked for). The quota does not apply: the period is rolling
  // over regardless, so it resets with it (finalize_subscription_invoice_paid
  // already resets upgrade_count_this_period to 0 on every subscription
  // payment) — but the rank gate above still applies unconditionally.
  if (daysRemaining === 0) {
    const { data: existingRenewal, error: renewalLookupErr } = await supabaseAdmin
      .from('invoices')
      .select('id')
      .eq('center_id', centerId)
      .eq('invoice_type', 'subscription')
      .eq('billing_period_start', npd)
      .in('status', ['pending', 'overdue', 'failed'])
      .maybeSingle();

    if (renewalLookupErr) {
      console.error('[billing/upgrade] day-zero renewal lookup', renewalLookupErr);
      return NextResponse.json({ error: 'Failed to look up renewal invoice' }, { status: 500 });
    }

    let renewalInvoiceId: string;
    let chargedTotal: number;
    let feeAmount: number;

    if (existingRenewal?.id) {
      const reprice = await repriceSubscriptionInvoice(supabaseAdmin, {
        invoiceId: existingRenewal.id as string,
        centerId,
        newBase: newPlanFullPeriodPrice,
      });
      if (!reprice.ok) {
        console.error('[billing/upgrade] day-zero reprice refused', reprice.code, reprice.message);
        Sentry.withScope((scope) => {
          scope.setTag('area', 'billing_upgrade_day_zero');
          scope.setTag('center_id', centerId);
          scope.setTag('reprice_refusal', reprice.code);
          scope.setLevel('warning');
          Sentry.captureMessage(`billing/upgrade day-zero reprice refused: ${reprice.code}`);
        });
        return NextResponse.json(
          { error: 'Could not update the pending renewal invoice.', code: reprice.code },
          { status: reprice.code === 'PARTIAL_PAYMENT_RECEIVED' ? 409 : 500 },
        );
      }
      renewalInvoiceId = reprice.invoiceId;
      chargedTotal = reprice.total;
      feeAmount = reprice.fee;
    } else {
      // Cron outage / not yet created (should be rare — the cron creates this
      // at next_payment_due - 7): mint it ourselves, same shape the cron uses.
      const feeCfg = await getProcessingFeeConfig();
      const { fee, total } = applyProcessingFee(newPlanFullPeriodPrice, feeCfg);
      const billingEnd = addMonthsToDateStr(npd, centerRenewalPeriodMonths(newBp));
      const invoiceNumber = `INV-${code}-${npd.slice(0, 7)}`;

      const { data: created, error: createErr } = await supabaseAdmin
        .from('invoices')
        .insert({
          center_id: centerId,
          invoice_number: invoiceNumber,
          invoice_type: 'subscription',
          status: 'pending',
          total_amount: total,
          base_amount: newPlanFullPeriodPrice,
          ...buildInvoiceTaxSnapshot({ total, fee }),
          billing_period_start: npd,
          billing_period_end: billingEnd,
          due_date: npd,
          metadata: { processing_fee: fee },
        })
        .select('id')
        .single();

      if (createErr || !created?.id) {
        console.error('[billing/upgrade] day-zero renewal invoice create', createErr);
        return NextResponse.json({ error: 'Failed to create renewal invoice' }, { status: 500 });
      }
      renewalInvoiceId = created.id as string;
      chargedTotal = total;
      feeAmount = fee;
    }

    // Last write wins: whichever plan change the customer most recently
    // requested occupies the one renewal slot — this overwrites any pending
    // downgrade schedule (or a prior day-zero upgrade request), never merges.
    const { error: schedErr } = await supabaseAdmin
      .from('centers')
      .update({
        scheduled_plan: newPlan,
        scheduled_billing_period: newBp,
      })
      .eq('id', centerId);
    if (schedErr) {
      console.error('[billing/upgrade] day-zero schedule', schedErr);
      return NextResponse.json({ error: 'Failed to schedule plan change' }, { status: 500 });
    }

    try {
      const checkout = await mintCheckoutForInvoice(supabaseAdmin, {
        invoiceId: renewalInvoiceId,
        centerId,
        amountEgp: chargedTotal,
        merchantOrderIdPrefix: 'upg-dz',
        phoneDigits: phone,
        displayName,
        existingMetadata: { processing_fee: feeAmount },
      });

      return NextResponse.json({
        paymobUrl: checkout.iframeUrl,
        paymobOrderId: checkout.paymobOrderId,
        invoiceId: renewalInvoiceId,
        dayZero: true,
        breakdown: {
          daysRemaining: 0,
          amountDue: newPlanFullPeriodPrice,
          processingFee: feeAmount,
          chargedTotal,
        },
        newNextPaymentDue: npd,
        upgrade_count_this_period: Number(c.upgrade_count_this_period ?? 0),
      });
    } catch (e) {
      // Deliberately NOT rolled back: the (re)priced invoice and the schedule
      // are already mutually consistent (whichever plan is scheduled matches
      // what the invoice now bills), and the invoice remains independently
      // payable via the customer's normal invoices/pay surface even without a
      // checkout URL from THIS request — rolling back scheduled_plan here
      // while leaving the invoice at the new price would instead be the
      // inconsistent state: paying that invoice would then advance the
      // renewal WITHOUT flipping the plan the customer is being charged for.
      console.error('[billing/upgrade] day-zero paymob', e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Payment setup failed' },
        { status: 500 },
      );
    }
  }

  // ── Mid-cycle: daysRemaining > 0 — the existing prorated-difference path ──
  // The quota applies here (it did not for day-zero, above).
  const upgradeLimit = getUpgradeLimit(periodForLimit);
  if (Number(c.upgrade_count_this_period ?? 0) >= upgradeLimit) {
    return NextResponse.json(
      { error: `Upgrade limit reached for this billing period (${upgradeLimit} per period)` },
      { status: 400 },
    );
  }

  // Daily-rate-difference proration for the days left in the paid period,
  // keeping the existing renewal date (G7). getUpgradeCost's own clamp bounds
  // daysRemaining to one period's length, which for a same-interval upgrade
  // (the only shape left on this route) already keeps amountDue <= the new
  // plan's own full period price — no separate cap needed here.
  const cappedProratedCost = Math.max(0, cost.amountDue);
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
        // it as upgrade_log.billing_anchor_unchanged, uses it to find and reprice
        // any pending renewal invoice for the SAME period so the next renewal
        // doesn't bill the old plan, and the Paymob webhook uses it for the
        // payment-confirmed WhatsApp period line.
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
    const checkout = await mintCheckoutForInvoice(supabaseAdmin, {
      invoiceId,
      centerId,
      amountEgp: chargedTotal,
      merchantOrderIdPrefix: 'upg',
      phoneDigits: phone,
      displayName,
      existingMetadata: { processing_fee: processingFee },
    });

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
