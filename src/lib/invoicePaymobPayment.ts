import type { SupabaseClient } from '@supabase/supabase-js';

const PERIOD_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
  semi_annual: 6,
  annual: 12,
};

/**
 * Mark invoice paid and extend center billing dates (same idea as admin approve-payment).
 */
export async function finalizeInvoicePaymentSuccess(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<{ invoiceId: string } | null> {
  const { data: inv } = await supabaseAdmin
    .from('invoices')
    .select('id, center_id, status')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  if (!inv) return null;

  const row = inv as { id: string; center_id: string; status: string };
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
      next_billing_date: nextDueStr,
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
