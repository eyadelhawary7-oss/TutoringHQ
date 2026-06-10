/**
 * Calculate referral rewards - invoked by calculate-rewards Edge Function (1st of month)
 * REWARD RULES: Month 1: 25% (held 1 month); Months 2-12: 10%; Month 13+: 5%
 * All conditional on referred center being active and paid that month.
 * Release held rewards 30+ days old → status=available
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  return auth === `Bearer ${key}`;
}

function getRewardPercentage(monthNumber: number): number {
  if (monthNumber === 1) return 25;
  if (monthNumber >= 2 && monthNumber <= 12) return 10;
  return 5;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let processed = 0;

  const { data: referrals, error: refErr } = await supabase
    .from('referrals')
    .select('id, referrer_center_id, referred_center_id, referred_first_paid_at')
    .in('status', ['active', 'converted', 'pending']);

  if (refErr || !referrals?.length) {
    const { error: releaseErr } = await supabase
      .from('referral_reward_records')
      .update({ status: 'available' })
      .eq('status', 'held')
      .lt('held_until', thirtyDaysAgo);
    return NextResponse.json({ ok: true, processed: 0, released: releaseErr ? 0 : 1 });
  }

  for (const ref of referrals as { id: string; referrer_center_id: string; referred_center_id: string; referred_first_paid_at: string | null }[]) {
    const referredCenterId = ref.referred_center_id;
    const firstPaidAt = ref.referred_first_paid_at;

    const { data: referredCenter } = await supabase
      .from('centers')
      .select('id, subscription_status, status')
      .eq('id', referredCenterId)
      .single();

    const isActive = (referredCenter as { subscription_status?: string; status?: string } | null)?.subscription_status === 'active' &&
      (referredCenter as { status?: string })?.status !== 'deleted';
    if (!isActive) continue;

    // Center billing: admin_payments (manual/admin-approved) + payments (Paymob, student_id IS NULL)
    const [{ data: adminPayments }, { data: payments }] = await Promise.all([
      supabase
        .from('admin_payments')
        .select('amount, paid_at')
        .eq('center_id', referredCenterId)
        .gte('paid_at', `${thisMonth}-01T00:00:00`)
        .lte('paid_at', `${thisMonth}-31T23:59:59`),
      supabase
        .from('payments')
        .select('amount, paid_at, confirmed, student_id')
        .eq('center_id', referredCenterId)
        .eq('confirmed', true)
        .is('student_id', null)
        .gte('paid_at', `${thisMonth}-01T00:00:00`)
        .lte('paid_at', `${thisMonth}-31T23:59:59`),
    ]);

    const fromAdmin = (adminPayments || []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const fromPayments = (payments || []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const paidThisMonth = fromAdmin + fromPayments;
    if (paidThisMonth <= 0) continue;

    let firstPaidDate: Date;
    if (firstPaidAt) {
      firstPaidDate = new Date(firstPaidAt);
    } else {
      const allPaidAts = [
        ...(adminPayments || []).map((p) => p.paid_at),
        ...(payments || []).map((p) => p.paid_at),
      ].filter(Boolean) as string[];
      const earliest = allPaidAts.sort()[0];
      const paidAt = earliest ? new Date(earliest) : now;
      firstPaidDate = paidAt;
      await supabase.from('referrals').update({
        referred_first_paid_at: paidAt.toISOString(),
        status: 'converted',
        converted_at: now.toISOString(),
      }).eq('id', ref.id);
    }
    const monthNumber = Math.max(1, (now.getFullYear() - firstPaidDate.getFullYear()) * 12 + (now.getMonth() - firstPaidDate.getMonth()) + 1);
    const pct = getRewardPercentage(monthNumber);
    const rewardAmount = Math.round(paidThisMonth * (pct / 100) * 100) / 100;
    const isMonth1 = monthNumber === 1;
    const heldUntil = isMonth1 ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;

    const { error: insErr } = await supabase.from('referral_reward_records').upsert(
      {
        referral_id: ref.id,
        referrer_center_id: ref.referrer_center_id,
        referred_center_id: referredCenterId,
        month_number: monthNumber,
        reward_percentage: pct,
        base_amount: paidThisMonth,
        reward_amount: rewardAmount,
        status: isMonth1 ? 'held' : 'available',
        held_until: heldUntil,
        period_month: thisMonth,
      },
      { onConflict: 'referral_id,period_month' }
    );

    if (!insErr) processed++;
  }

  const { data: released } = await supabase
    .from('referral_reward_records')
    .update({ status: 'available', held_until: null })
    .eq('status', 'held')
    .lt('held_until', thirtyDaysAgo)
    .select('id');

  return NextResponse.json({
    ok: true,
    processed,
    released: released?.length ?? 0,
  });
}
