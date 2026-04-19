import { NextRequest, NextResponse } from 'next/server';
import { formatNumber } from '@/lib/formatNumber';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const amountRequested = Number(body?.amount_requested ?? 0);
    const paymentMethod = typeof body?.payment_method === 'string' ? body.payment_method : 'bank_transfer';
    const paymentDetails = body?.payment_details && typeof body.payment_details === 'object' ? body.payment_details : null;

    if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
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

    const { data: payout, error: insertErr } = await auth.supabaseAdmin
      .from('payout_requests')
      .insert({
        center_id: centerId,
        amount_requested: amountRequested,
        status: 'pending',
        payment_method: paymentMethod,
        payment_details: paymentDetails,
      })
      .select('id, amount_requested, status, requested_at')
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, payout });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
