import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { todayISO } from '@/lib/parentPack';

export const dynamic = 'force-dynamic';

function isWithdrawalWindow(ymd: string): boolean {
  const [, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return [1, 4, 7, 10].includes(m) && d >= 1 && d <= 14;
}

/** Next Jan/Apr/Jul/Oct 1 on or after `ymd` (YYYY-MM-DD, Cairo calendar string). */
function nextQuarterFirstOnOrAfter(ymd: string): string {
  const [y0, m0, d0] = ymd.split('-').map((x) => parseInt(x, 10));
  for (let i = 0; i < 500; i++) {
    const dt = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if ([1, 4, 7, 10].includes(m) && d === 1) {
      return `${y}-${String(m).padStart(2, '0')}-01`;
    }
  }
  return ymd;
}

function nextProcessingQuarterStart(ymd: string): string {
  const [y, m] = ymd.split('-').map((x) => parseInt(x, 10));
  if (m <= 3) return `${y}-04-01`;
  if (m <= 6) return `${y}-07-01`;
  if (m <= 9) return `${y}-10-01`;
  return `${y + 1}-01-01`;
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { creditAmount?: number };
  try {
    body = (await request.json()) as typeof body;
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
    .select('id, instapay_number, credit_balance')
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    instapay_number?: string | null;
    credit_balance?: number | string | null;
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

  const balance = Number(c.credit_balance ?? 0);
  if (balance < creditAmount) {
    return NextResponse.json({ error: 'Insufficient credit balance' }, { status: 400 });
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

  const today = todayISO();
  if (!isWithdrawalWindow(today)) {
    const next = nextQuarterFirstOnOrAfter(today);
    return NextResponse.json(
      {
        error: `Withdrawals are processed quarterly. Next window: ${next}`,
      },
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
    return NextResponse.json({ error: 'Failed to submit withdrawal' }, { status: 500 });
  }

  return NextResponse.json({
    cashAmount,
    feeAmount,
    instapay,
    processingDate: nextProcessingQuarterStart(today),
  });
}
