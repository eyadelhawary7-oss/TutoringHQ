import { NextRequest, NextResponse } from 'next/server';
import { formatNumber } from '@/lib/formatNumber';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { parseBodyWithLimit } from '@/lib/validate';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import { computeReferralPayout, REFERRAL_WITHDRAWAL_MIN_EGP } from '@/lib/referralPayout';
import { validateCSRFRequest } from '@/lib/csrf';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    // PAYOUT-SYSTEM-SPEC.md §2.6 / S7: this route creates a money-movement
    // request and had no CSRF check at all.
    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
    const permErr = requirePermission(auth, 'can_request_referral_payouts');
    if (permErr) return permErr;

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;

    const ALLOWED_PAYMENT_METHODS = ['instapay'];
    const paymentMethod =
      typeof body.payment_method === 'string' ? body.payment_method.trim().toLowerCase() : '';
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }

    // `amount_requested` is the GROSS commission withdrawn (deducted from balance).
    const amountRequested = Number(body?.amount_requested ?? 0);
    const clientDetails =
      body?.payment_details && typeof body.payment_details === 'object'
        ? (body.payment_details as Record<string, unknown>)
        : null;

    if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Minimum cash withdrawal, checked on the GROSS (before the 20 + 5% fees).
    if (amountRequested < REFERRAL_WITHDRAWAL_MIN_EGP) {
      return NextResponse.json(
        {
          error: `Minimum withdrawal is ${formatNumber(REFERRAL_WITHDRAWAL_MIN_EGP, 'en')} EGP`,
          code: 'below_minimum',
        },
        { status: 400 },
      );
    }

    const centerId = auth.centerId;

    // Available balance from referral_reward_records
    const { data: records } = await auth.supabaseAdmin
      .from('referral_reward_records')
      .select('reward_amount')
      .eq('referrer_center_id', centerId)
      .eq('status', 'available');

    const available = (records || []).reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0);

    if (amountRequested > available) {
      return NextResponse.json(
        { error: `Amount requested exceeds available balance (${formatNumber(available, 'en')} EGP)` },
        { status: 400 }
      );
    }

    // Fees are ALWAYS computed server-side (never trust a client-sent fee/net).
    // Order: flat 20 EGP processing fee first, then 5% withdrawal fee on the rest.
    const processingFeeAmount = resolveProcessingFeeAmount(await getProcessingFeeConfig());
    const breakdown = computeReferralPayout(amountRequested, processingFeeAmount);

    // Floor safety: the gross must exceed the flat fee so net stays positive.
    if (breakdown.net <= 0) {
      return NextResponse.json(
        {
          error: `Withdrawal must exceed the ${formatNumber(processingFeeAmount, 'en')} EGP processing fee`,
          code: 'below_fee_floor',
        },
        { status: 400 },
      );
    }

    const instapayNumber =
      clientDetails && typeof clientDetails.instapay_number === 'string'
        ? clientDetails.instapay_number
        : null;

    const { data: payout, error: insertErr } = await auth.supabaseAdmin
      .from('payout_requests')
      .insert({
        center_id: centerId,
        amount_requested: amountRequested,
        status: 'pending',
        payment_method: paymentMethod,
        // Server-authoritative breakdown; the receipt renders from these fields.
        payment_details: {
          instapay_number: instapayNumber,
          gross_amount: breakdown.gross,
          processing_fee: breakdown.processingFee,
          withdrawal_fee: breakdown.withdrawalFee,
          net_amount: breakdown.net,
        },
      })
      .select('id, amount_requested, status, requested_at')
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, payout, breakdown });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
