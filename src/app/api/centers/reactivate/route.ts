import { NextRequest, NextResponse } from 'next/server';
import { getPeriodMultiplier } from '@/lib/billingEngine';
import { requireCenterAuth } from '@/lib/centerAuth';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { calculateReactivationFee, sumSubscriptionInvoiceTotals } from '@/lib/reactivationFee';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';

function billingPeriodKey(sub: string | null | undefined): 'monthly' | 'quarterly' | 'annual' {
  const p = (sub ?? 'quarterly').toLowerCase();
  if (p === 'monthly') return 'monthly';
  if (p === 'annual' || p === 'yearly') return 'annual';
  return 'quarterly';
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, status, name, phone, dormancy_date, active_months_count, billing_amount, all_in_price, subscription_billing_period, billing_period, center_code, referral_code',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as Record<string, unknown>;
  if (String(c.status) !== 'dormant') {
    return NextResponse.json({ error: 'Center is not dormant' }, { status: 400 });
  }

  const { data: pendingRow } = await supabaseAdmin
    .from('invoices')
    .select('id, paymob_iframe_url, paymob_order_id')
    .eq('center_id', centerId)
    .eq('invoice_type', 'reactivation_fee')
    .in('status', ['pending', 'overdue'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const pending = pendingRow as {
    id: string;
    paymob_iframe_url?: string | null;
    paymob_order_id?: string | null;
  } | null;

  if (pending?.paymob_iframe_url?.trim() && pending?.paymob_order_id?.trim()) {
    return NextResponse.json({
      invoiceId: pending.id,
      paymobUrl: pending.paymob_iframe_url,
      paymobOrderId: pending.paymob_order_id,
      existing: true,
    });
  }

  if (pending?.id) {
    await supabaseAdmin.from('invoices').delete().eq('id', pending.id);
  }

  const activeMonths = Math.max(0, Math.floor(Number(c.active_months_count ?? 0)));
  const sumInv = await sumSubscriptionInvoiceTotals(supabaseAdmin, centerId);
  const divisor = Math.max(1, activeMonths);
  let avgMonthly = sumInv > 0 ? sumInv / divisor : 0;
  if (avgMonthly <= 0) {
    const mult = getPeriodMultiplier(
      billingPeriodKey(
        c.subscription_billing_period != null
          ? String(c.subscription_billing_period)
          : (c.billing_period as string | null | undefined),
      ),
    );
    const ba = Number(c.billing_amount ?? 0);
    const allIn = Number(c.all_in_price ?? 0);
    const perPeriod = ba > 0 ? ba : allIn * mult;
    avgMonthly = mult > 0 ? perPeriod / mult : perPeriod;
  }
  if (!Number.isFinite(avgMonthly) || avgMonthly < 0) avgMonthly = 1999;

  const { baseFee, discountRate, finalFee } = calculateReactivationFee(activeMonths, avgMonthly);
  const discountAmt = Math.round(baseFee * discountRate * 100) / 100;

  // Flat processing fee (Section 5) added on top of the reactivation fee as its
  // own line; charged total = reactivation fee + processing fee.
  const feeCfg = await getProcessingFeeConfig();
  const processingFee = resolveProcessingFeeAmount(feeCfg);
  const chargedTotal = Math.round((finalFee + processingFee) * 100) / 100;

  const codeRaw = String((c.center_code || c.referral_code || '') as string).trim().replace(/\s+/g, '');
  const code = codeRaw || 'UNK';
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const invNo = `REACT-${code}-${ym}-${rand}`;

  const dormancyYmd = c.dormancy_date ? String(c.dormancy_date).slice(0, 10) : null;
  const todayYmd = new Date().toISOString().slice(0, 10);
  let suspensionDays = 0;
  if (dormancyYmd) {
    suspensionDays = Math.max(
      0,
      Math.floor(
        (new Date(`${todayYmd}T12:00:00`).getTime() - new Date(`${dormancyYmd}T12:00:00`).getTime()) /
          86400000,
      ),
    );
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      center_id: centerId,
      invoice_number: invNo,
      invoice_type: 'reactivation_fee',
      base_amount: baseFee,
      total_amount: chargedTotal,
      discount_amount: discountAmt,
      billing_period_start: dormancyYmd,
      billing_period_end: todayYmd,
      due_date: todayYmd,
      status: 'pending',
      metadata: {
        active_months_count: activeMonths,
        avg_monthly_price: avgMonthly,
        base_fee: baseFee,
        discount_rate: discountRate,
        final_fee: finalFee,
        suspension_started: dormancyYmd,
        suspension_days: suspensionDays,
        processing_fee: processingFee,
      },
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
      itemName: 'TutoringHQ reactivation',
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
      breakdown: {
        baseFee,
        discountRate,
        discountAmount: discountAmt,
        finalFee,
        processingFee,
        total: chargedTotal,
        avgMonthly,
        activeMonths,
      },
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
