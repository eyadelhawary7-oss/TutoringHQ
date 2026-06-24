import { NextRequest, NextResponse } from 'next/server';
import { getPeriodMultiplier } from '@/lib/billingEngine';
import { requireCenterAuth } from '@/lib/centerAuth';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { reactivationChargeAmount } from '@/lib/billingLifecycle';

function billingPeriodKey(sub: string | null | undefined): 'monthly' | 'quarterly' | 'annual' {
  const p = (sub ?? 'quarterly').toLowerCase();
  if (p === 'monthly') return 'monthly';
  if (p === 'annual' || p === 'yearly') return 'annual';
  return 'quarterly';
}

/**
 * Reactivation (single-day lock model): a locked center pays its PLAIN subscription
 * price to come back — no late fee, no reactivation fee, no surcharge
 * (src/lib/billingLifecycle.ts, rule 4). Charges the period subscription as a normal
 * `subscription` invoice; the webhook (handleSubscriptionInvoicePaid) reactivates.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request, { allowSuspended: true });
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, status, name, phone, billing_amount, all_in_price, subscription_billing_period, billing_period, center_code, referral_code',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as Record<string, unknown>;
  // Locked states under the new model: 'suspended' (and legacy 'dormant').
  if (!['suspended', 'dormant'].includes(String(c.status))) {
    return NextResponse.json({ error: 'Center is not locked' }, { status: 400 });
  }

  // Plain subscription period charge — billing_amount, else all_in × period multiplier.
  const mult = getPeriodMultiplier(
    billingPeriodKey(
      c.subscription_billing_period != null
        ? String(c.subscription_billing_period)
        : (c.billing_period as string | null | undefined),
    ),
  );
  const ba = Number(c.billing_amount ?? 0);
  const allIn = Number(c.all_in_price ?? 0);
  const subscription = ba > 0 ? ba : allIn > 0 ? Math.round(allIn * mult) : 0;
  const chargedTotal = reactivationChargeAmount(subscription);
  if (chargedTotal <= 0) {
    return NextResponse.json({ error: 'Invalid subscription amount' }, { status: 400 });
  }

  const codeRaw = String((c.center_code || c.referral_code || '') as string).trim().replace(/\s+/g, '');
  const code = codeRaw || 'UNK';
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const invNo = `REACT-${code}-${ym}-${rand}`;
  const todayYmd = new Date().toISOString().slice(0, 10);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      center_id: centerId,
      invoice_number: invNo,
      invoice_type: 'subscription',
      base_amount: subscription,
      total_amount: chargedTotal,
      billing_period_start: todayYmd,
      billing_period_end: todayYmd,
      due_date: todayYmd,
      status: 'pending',
      metadata: { reactivation: true, processing_fee: 0 },
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    console.error('[centers/reactivate] insert', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Failed to create invoice' }, { status: 500 });
  }

  const invoiceId = String(inserted.id);
  const centerName = String(c.name ?? 'Center').trim() || 'Center';
  const rawPhone = String(c.phone ?? '').replace(/\D/g, '') || '0';

  try {
    const checkout = await createPaymobCheckoutEgp({
      amountEgp: chargedTotal,
      merchantOrderId: invoiceId,
      itemName: 'TutoringHQ subscription',
      phoneDigits: rawPhone,
      displayName: centerName,
    });

    const { error: upErr } = await supabaseAdmin
      .from('invoices')
      .update({
        paymob_order_id: checkout.paymobOrderId,
        paymob_iframe_url: checkout.iframeUrl,
      })
      .eq('id', invoiceId)
      .in('status', ['pending', 'overdue']);

    if (upErr) {
      console.error('[centers/reactivate] paymob save', upErr);
      await supabaseAdmin.from('invoices').delete().eq('id', invoiceId);
      return NextResponse.json({ error: 'Failed to save payment session' }, { status: 500 });
    }

    return NextResponse.json({
      invoiceId,
      paymobUrl: checkout.iframeUrl,
      paymobOrderId: checkout.paymobOrderId,
      total: chargedTotal,
    });
  } catch (e) {
    await supabaseAdmin.from('invoices').delete().eq('id', invoiceId);
    console.error('[centers/reactivate] paymob', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Payment setup failed' },
      { status: 500 },
    );
  }
}
