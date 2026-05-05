import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  getTodayCairo,
  isWithdrawalWindowOpen,
  nextProcessingQuarterStart,
  nextQuarterFirstOnOrAfter,
} from '@/lib/cairoBillingCalendar';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { creditAmount?: number };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const creditAmount = Number(body.creditAmount);
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    return NextResponse.json({ error: 'Invalid credit amount' }, { status: 400 });
  }

  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: cErr } = await supabaseAdmin
    .from('centers')
    .select('id, instapay_number, credit_balance, credit_reserved')
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    instapay_number?: string | null;
    credit_balance?: number | string | null;
    credit_reserved?: number | string | null;
  };

  const instapay = (c.instapay_number ?? '').trim();
  if (!instapay) {
    return NextResponse.json(
      { error: 'Please add your InstaPay number in Settings first' },
      { status: 400 },
    );
  }

  if (creditAmount < 2000) {
    return NextResponse.json(
      { error: 'Minimum withdrawal is 2,000 credits (you receive 1,000 EGP)' },
      { status: 400 },
    );
  }

  const available =
    Number(c.credit_balance ?? 0) - Number(c.credit_reserved ?? 0);

  if (available < creditAmount) {
    return NextResponse.json(
      { error: 'Insufficient available credits (after reservations)' },
      { status: 400 },
    );
  }

  const { data: pending } = await supabaseAdmin
    .from('withdrawal_requests')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending?.id) {
    return NextResponse.json(
      { error: 'You already have a pending withdrawal request' },
      { status: 400 },
    );
  }

  const today = getTodayCairo();
  if (!isWithdrawalWindowOpen()) {
    const next = nextQuarterFirstOnOrAfter(today);
    return NextResponse.json(
      {
        error: `Withdrawals are processed quarterly. Next window: ${next}`,
      },
      { status: 400 },
    );
  }

  const { data: reserved, error: resErr } = await supabaseAdmin.rpc('reserve_credits_atomic', {
    p_center_id: centerId,
    p_amount: creditAmount,
  });

  if (resErr) {
    console.error('[billing/withdrawal] reserve_credits_atomic', resErr);
    return NextResponse.json(
      { error: 'Could not reserve credits. Try again.' },
      { status: 400 },
    );
  }

  if (!reserved) {
    return NextResponse.json(
      { error: 'Could not reserve credits. Try again.' },
      { status: 400 },
    );
  }

  const cashAmount = creditAmount / 2;
  const feeAmount = creditAmount / 2;

  const { error: insErr } = await supabaseAdmin.from('withdrawal_requests').insert({
    center_id: centerId,
    credits_deducted: creditAmount,
    cash_amount: cashAmount,
    fee_amount: feeAmount,
    instapay_number: instapay,
    status: 'pending',
  });

  if (insErr) {
    console.error('[billing/withdrawal] insert', insErr);
    await supabaseAdmin.rpc('cancel_reservation_atomic', {
      p_center_id: centerId,
      p_amount: creditAmount,
    });
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
  }

  return NextResponse.json({
    cashAmount,
    feeAmount,
    instapay,
    processingDate: nextProcessingQuarterStart(today),
  });
}
