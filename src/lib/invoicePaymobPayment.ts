import type { SupabaseClient } from '@supabase/supabase-js';
import { todayISO } from '@/lib/parentPack';
import { computeNextQuarterlyPaymentDue } from '@/lib/subscriptionAnchor';
import { sendChqPaymentConfirmedTemplate } from '@/lib/centerNotify';

const PERIOD_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
  semi_annual: 6,
  annual: 12,
};

function calendarAddDays(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const QUARTERLY_LABEL_AR = 'ربع سنوي';

async function handlePlanUpgradeInvoicePaid(
  supabaseAdmin: SupabaseClient,
  inv: { id: string; center_id: string; total_amount: number | string | null },
  paymobTransactionId: string,
): Promise<void> {
  const { data: pr } = await supabaseAdmin
    .from('plan_requests')
    .select('id, requested_plan')
    .eq('center_id', inv.center_id)
    .eq('status', 'pending_payment')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pr?.requested_plan) {
    console.error('[invoicePaymob] plan upgrade paid but no pending_payment request', inv.center_id);
    return;
  }

  const rp = pr.requested_plan as string;
  const { data: priceRow } = await supabaseAdmin
    .from('pricing_plans')
    .select('all_in_price')
    .eq('id', rp)
    .maybeSingle();

  const newAmt = Number((priceRow as { all_in_price?: number | null } | null)?.all_in_price);
  if (!Number.isFinite(newAmt) || newAmt <= 0) {
    console.error('[invoicePaymob] plan upgrade paid but invalid all_in_price', rp);
    return;
  }

  await supabaseAdmin
    .from('centers')
    .update({
      plan: rp,
      billing_amount: newAmt,
      all_in_price: newAmt,
      billing_status: 'paid',
    })
    .eq('id', inv.center_id);

  await supabaseAdmin
    .from('plan_requests')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', pr.id);

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name, phone, billing_amount')
    .eq('id', inv.center_id)
    .maybeSingle();

  const c = center as { name?: string; phone?: string | null; billing_amount?: number | null } | null;
  await sendChqPaymentConfirmedTemplate(supabaseAdmin, {
    name: c?.name ?? '—',
    phone: c?.phone ?? null,
    billingPeriodLabel: QUARTERLY_LABEL_AR,
    billingAmountStr: String(c?.billing_amount ?? newAmt),
  });
}

async function handleSubscriptionInvoicePaid(
  supabaseAdmin: SupabaseClient,
  inv: { id: string; center_id: string; total_amount: number | string | null },
  paymobTransactionId: string,
): Promise<void> {
  const { data: center } = await supabaseAdmin
    .from('centers')
    .select(
      'billing_status, status, subscription_status, next_payment_due, subscription_start_date, billing_cycle_start, approved_at, name, phone, billing_amount',
    )
    .eq('id', inv.center_id)
    .maybeSingle();

  const c = center as {
    billing_status?: string | null;
    status?: string | null;
    subscription_status?: string | null;
    next_payment_due?: string | null;
    subscription_start_date?: string | null;
    billing_cycle_start?: string | null;
    approved_at?: string | null;
    name?: string | null;
    phone?: string | null;
    billing_amount?: number | null;
  } | null;

  if (!c) return;

  const wasSuspendedBilling = c.billing_status === 'suspended';
  const newDue = computeNextQuarterlyPaymentDue({
    next_payment_due: c.next_payment_due ?? null,
    subscription_start_date: c.subscription_start_date,
    billing_cycle_start: c.billing_cycle_start,
    approved_at: c.approved_at,
  });
  const autoSus = calendarAddDays(newDue, 8);
  const totalAmt = Number(inv.total_amount ?? 0);
  const today = todayISO();

  await supabaseAdmin.from('renewal_history').insert({
    center_id: inv.center_id,
    renewal_date: today,
    amount_paid: totalAmt,
    payment_method: 'paymob',
    recorded_by: null,
  });

  const centerUpdates: Record<string, unknown> = {
    billing_status: 'paid',
    next_payment_due: newDue,
    auto_suspend_at: `${autoSus}T12:00:00.000Z`,
    last_payment_date: today,
  };

  if (wasSuspendedBilling) {
    centerUpdates.status = 'active';
    centerUpdates.subscription_status = 'active';
  }

  const { error: cErr } = await supabaseAdmin.from('centers').update(centerUpdates).eq('id', inv.center_id);
  if (cErr) {
    console.error('[invoicePaymob] center update subscription paid', cErr);
  }

  await sendChqPaymentConfirmedTemplate(supabaseAdmin, {
    name: c.name ?? '—',
    phone: c.phone ?? null,
    billingPeriodLabel: QUARTERLY_LABEL_AR,
    billingAmountStr: String(c.billing_amount ?? totalAmt),
  });
}

/**
 * Mark invoice paid and extend center billing (subscription / plan upgrade / legacy).
 */
export async function finalizeInvoicePaymentSuccess(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<{ invoiceId: string } | null> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, center_id, status, invoice_type, total_amount')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  if (!inv) return null;

  const row = inv as {
    id: string;
    center_id: string;
    status: string;
    invoice_type: string | null;
    total_amount: number | string | null;
  };

  if (row.status === 'paid') {
    return { invoiceId: row.id };
  }

  const { error: invErr } = await supabaseAdmin
    .from('invoices')
    .update({
      status: 'paid',
      payment_method: 'paymob',
      payment_reference: paymobTransactionId,
      paymob_transaction_id: paymobTransactionId,
      paid_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  if (invErr) {
    console.error('[finalizeInvoicePaymentSuccess] invoice', invErr);
    return null;
  }

  if (row.invoice_type === 'plan_upgrade_difference') {
    await handlePlanUpgradeInvoicePaid(supabaseAdmin, row, paymobTransactionId);
    return { invoiceId: row.id };
  }

  if (row.invoice_type === 'subscription') {
    await handleSubscriptionInvoicePaid(supabaseAdmin, row, paymobTransactionId);
    return { invoiceId: row.id };
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('billing_period, status, subscription_status, next_payment_due')
    .eq('id', row.center_id)
    .maybeSingle();

  if (center) {
    const bp = (center as { billing_period?: string | null }).billing_period ?? 'quarterly';
    const months = PERIOD_MONTHS[bp] ?? 3;
    const currentDue = (center as { next_payment_due?: string | null }).next_payment_due;
    const base = currentDue ? new Date(`${currentDue}T12:00:00`) : new Date();
    base.setMonth(base.getMonth() + months);
    const nextDueStr = base.toISOString().slice(0, 10);

    const centerUpdates: Record<string, unknown> = {
      billing_status: 'paid',
      last_payment_date: new Date().toISOString().slice(0, 10),
      next_payment_due: nextDueStr,
      payment_due_date: nextDueStr,
    };
    const st = (center as { status?: string | null }).status;
    if (st === 'suspended') {
      centerUpdates.status = 'active';
      centerUpdates.subscription_status = 'active';
    }

    const { error: cErr } = await supabaseAdmin.from('centers').update(centerUpdates).eq('id', row.center_id);
    if (cErr) {
      console.error('[finalizeInvoicePaymentSuccess] center', cErr);
    }
  }

  return { invoiceId: row.id };
}

export async function finalizeInvoicePaymentFailure(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
): Promise<void> {
  await supabaseAdmin
    .from('invoices')
    .update({ status: 'failed' })
    .eq('paymob_order_id', paymobOrderId)
    .neq('status', 'paid');
}

/**
 * Paymob marks settled transactions with is_voided / is_refunded in the HMAC payload (chargeback / reversal).
 */
export async function finalizeInvoiceChargeback(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<void> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, center_id, status, total_amount')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  const row = inv as { id: string; center_id: string; status: string; total_amount?: number | string } | null;
  if (!row || row.status !== 'paid') return;

  await supabaseAdmin.from('invoices').update({ status: 'chargeback' }).eq('id', row.id);

  await supabaseAdmin
    .from('centers')
    .update({
      status: 'suspended',
      billing_status: 'suspended',
      subscription_status: 'suspended',
    })
    .eq('id', row.center_id);

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name')
    .eq('id', row.center_id)
    .maybeSingle();

  const name = (center as { name?: string } | null)?.name ?? '—';
  const ceoRaw = process.env.CEO_PHONE;
  if (!ceoRaw) return;

  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  const digits = ceoRaw.replace(/\D/g, '');
  if (!digits) return;

  const text = `Chargeback: ${name} — amount ${row.total_amount ?? '—'} EGP — Paymob txn ${paymobTransactionId}`;
  await sendWhatsAppMessage(digits, text);
}
