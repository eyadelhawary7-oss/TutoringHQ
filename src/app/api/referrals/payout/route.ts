import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { formatNumber } from '@/lib/formatNumber';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const amountRequested = Number(body?.amount_requested ?? 0);
    const paymentMethod = typeof body?.payment_method === 'string' ? body.payment_method : 'bank_transfer';
    const paymentDetails = body?.payment_details && typeof body.payment_details === 'object' ? body.payment_details : null;

    if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const centerId = ctx.user.center_id as string;

    // Available balance from referral_reward_records
    const { data: records } = await ctx.supabaseAdmin
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

    const { data: payout, error: insertErr } = await ctx.supabaseAdmin
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
