import type { SupabaseClient } from '@supabase/supabase-js';
import { createAction } from '@/lib/ceo';
import { sendWelcomeTemplate } from '@/lib/centerNotify';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

function parseConfigBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function addCalendarDaysFromToday(days: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function nextPaymentDueDaysForPeriod(bp: BillingPeriod): number {
  if (bp === 'monthly') return 30;
  if (bp === 'annual') return 365;
  return 90;
}

/**
 * After Paymob success: finalize signup combined session (invoices + session row), then apply platform_config auto-approval rules.
 */
export async function processSignupAutoApprovalAfterPaymobSuccess(
  supabase: SupabaseClient,
  orderId: string,
  paymobTransactionId: string,
): Promise<void> {
  const { data: session } = await supabase
    .from('combined_payment_sessions')
    .select('id, center_id, status, session_type, invoice_ids')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  const row = session as {
    id: string;
    center_id: string;
    status: string;
    session_type: string;
    invoice_ids: string[] | null;
  } | null;

  if (!row || row.session_type !== 'signup') return;

  const invIds = Array.isArray(row.invoice_ids) ? row.invoice_ids : [];
  for (const invId of invIds) {
    const { error: invErr } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        payment_method: 'paymob',
        payment_reference: paymobTransactionId,
        paymob_transaction_id: paymobTransactionId,
        paid_at: new Date().toISOString(),
      })
      .eq('id', invId)
      .eq('center_id', row.center_id)
      .neq('status', 'paid');
    if (invErr) {
      console.error('[signupAutoApprove] invoice mark paid', invErr);
    }
  }

  const { data: sessionWinner } = await supabase
    .from('combined_payment_sessions')
    .update({
      status: 'paid',
      finalized_at: new Date().toISOString(),
      finalized_by: 'webhook',
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, center_id')
    .maybeSingle();

  if (!sessionWinner) return;

  const centerId = sessionWinner.center_id as string;

  const { data: autoRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'auto_approve_signups')
    .maybeSingle();
  const { data: pauseRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'pause_new_signups')
    .maybeSingle();

  const autoApprove = parseConfigBool(autoRow?.value);
  const pauseIntake = parseConfigBool(pauseRow?.value);

  if (!autoApprove) {
    console.log('[signupAutoApprove] auto_approve_signups disabled, manual review needed');
    return;
  }

  const { data: center, error: centerErr } = await supabase
    .from('centers')
    .select(
      'id, name, plan, billing_period, subscription_billing_period, all_in_price, status, phone',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (centerErr || !center) {
    console.error('[signupAutoApprove] center load', centerErr);
    return;
  }

  const c = center as {
    id: string;
    name: string;
    plan: string | null;
    billing_period?: string | null;
    subscription_billing_period?: string | null;
    all_in_price?: number | null;
    status?: string | null;
    phone?: string | null;
  };

  if (pauseIntake) {
    const { error: updErr } = await supabase
      .from('centers')
      .update({
        status: 'paid_pending_activation',
        billing_status: 'paid',
      })
      .eq('id', centerId);

    if (updErr) {
      console.error('[signupAutoApprove] paid_pending_activation', updErr);
      return;
    }

    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: 'Center paid but intake paused',
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue intake paused', e);
    }
    return;
  }

  const planKey = c.plan ?? 'starter';
  const { data: priceByKey } = await supabase
    .from('pricing_plans')
    .select('all_in_price, monthly_fee, plan_key, id')
    .eq('plan_key', planKey)
    .maybeSingle();

  let priceRow = priceByKey;
  if (!priceRow) {
    const { data: byId } = await supabase
      .from('pricing_plans')
      .select('all_in_price, monthly_fee, plan_key, id')
      .eq('id', planKey)
      .maybeSingle();
    priceRow = byId ?? null;
  }

  let allIn = Number((priceRow as { all_in_price?: number | null } | null)?.all_in_price);
  const monthlyFee = Number((priceRow as { monthly_fee?: number | null } | null)?.monthly_fee);

  if (!Number.isFinite(allIn) || allIn <= 0) {
    const custom = Number(c.all_in_price);
    if (Number.isFinite(custom) && custom > 0) {
      allIn = custom;
    }
  }

  if (!Number.isFinite(allIn) || allIn <= 0 || !Number.isFinite(monthlyFee) || monthlyFee <= 0) {
    console.log(`[signupAutoApprove] Cannot auto-approve: invalid pricing for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid pricing for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue invalid pricing', e);
    }
    return;
  }

  const period = normalizeBillingPeriod(
    c.subscription_billing_period ?? c.billing_period,
  ) as BillingPeriod;
  const pk: PlanKey | undefined = isPlanKey(planKey) ? planKey : undefined;
  const billingAmount = getChargeFromQuarterlyAllIn(allIn, period, pk);

  if (!Number.isFinite(billingAmount) || billingAmount <= 0) {
    console.log(`[signupAutoApprove] Cannot auto-approve: billing_amount would be invalid for plan ${planKey}`);
    try {
      await createAction(supabase, {
        type: 'ops',
        priority: 'amber',
        center_id: centerId,
        title: `Cannot auto-approve: invalid billing amount for plan ${planKey}`,
        subtitle: c.name,
        revenue_at_risk: 0,
        auto_generated: true,
      });
    } catch (e) {
      console.error('[signupAutoApprove] ceo_action_queue billing amount', e);
    }
    return;
  }

  const dueDays = nextPaymentDueDaysForPeriod(period);
  const nextPaymentDue = addCalendarDaysFromToday(dueDays);
  const autoSuspendYmd = addCalendarDaysFromToday(dueDays + 6);

  const { error: actErr } = await supabase
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      approved_at: new Date().toISOString(),
      billing_amount: billingAmount,
      all_in_price: allIn,
      next_payment_due: nextPaymentDue,
      auto_suspend_at: `${autoSuspendYmd}T12:00:00.000Z`,
    })
    .eq('id', centerId);

  if (actErr) {
    console.error('[signupAutoApprove] center activation', actErr);
    return;
  }

  try {
    const { data: waCfg } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_sending_enabled')
      .maybeSingle();
    if (waCfg?.value !== false) {
      await sendWelcomeTemplate({ id: centerId, name: c.name, phone: c.phone ?? null });
    }
  } catch (e) {
    console.error('[signupAutoApprove] chq_welcome', e);
  }

  try {
    await supabase.from('cron_log').insert({
      cron_name: 'auto_approve',
      status: 'success',
      records_processed: 1,
      metadata: { center_id: centerId, order_id: orderId },
    });
  } catch (e) {
    console.error('[signupAutoApprove] cron_log', e);
  }

  try {
    await createAction(supabase, {
      type: 'ops',
      priority: 'green',
      center_id: centerId,
      title: `1 center auto-approved: ${c.name}`,
      revenue_at_risk: 0,
      auto_generated: true,
    });
  } catch (e) {
    console.error('[signupAutoApprove] ceo briefing', e);
  }
}
