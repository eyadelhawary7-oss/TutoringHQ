import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    const ctx = { supabaseAdmin: auth.supabaseAdmin };

    const centerId = auth.centerId;

    const { data: center } = await ctx.supabaseAdmin
      .from('centers')
      .select('referral_code, instapay_number')
      .eq('id', centerId)
      .single();

    // Referrals: our referred centers
    const { data: referrals } = await ctx.supabaseAdmin
      .from('referrals')
      .select('id, referred_center_id, status, referred_first_paid_at')
      .eq('referrer_center_id', centerId)
      .order('created_at', { ascending: false });

    const referredCenterIds = [...new Set((referrals || []).map((r: { referred_center_id: string }) => r.referred_center_id).filter(Boolean))];
    const centerNames: Record<string, string> = {};
    if (referredCenterIds.length > 0) {
      const { data: centers } = await ctx.supabaseAdmin
        .from('centers')
        .select('id, name')
        .in('id', referredCenterIds);
      (centers || []).forEach((c: { id: string; name: string }) => {
        centerNames[c.id] = c.name || ',';
      });
    }

    // referral_reward_records: monthly rewards (primary source)
    const { data: rewardRecords } = await ctx.supabaseAdmin
      .from('referral_reward_records')
      .select('id, referral_id, referred_center_id, month_number, reward_percentage, base_amount, reward_amount, status, held_until, paid_at, period_month, created_at')
      .eq('referrer_center_id', centerId)
      .order('period_month', { ascending: false });

    const records = rewardRecords || [];
    const totalEarned = records.reduce(
      (s: number, r: { reward_amount: number; status: string }) =>
        s + (['available', 'held', 'paid', 'pending'].includes(r.status) ? Number(r.reward_amount ?? 0) : 0),
      0
    );
    const available = records
      .filter((r: { status: string }) => r.status === 'available')
      .reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0);
    const pending = records
      .filter((r: { status: string }) => r.status === 'held' || r.status === 'pending')
      .reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0);
    const paidOut = records
      .filter((r: { status: string }) => r.status === 'paid')
      .reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0);

    // Active referrals: group by referral
    const referralMap = new Map<string, { referred_center_id: string; status: string; months: number; monthlyReward: number; total: number }>();
    for (const ref of referrals || []) {
      const refId = ref.id as string;
      const refCenterId = ref.referred_center_id as string;
      const refRecords = records.filter((r: { referral_id: string }) => r.referral_id === refId);
      const monthCount = refRecords.length > 0 ? Math.max(...refRecords.map((r: { month_number: number }) => r.month_number)) : 0;
      const monthlyReward = refRecords.length > 0
        ? refRecords.reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0) / refRecords.length
        : 0;
      const total = refRecords.reduce((s: number, r: { reward_amount: number }) => s + Number(r.reward_amount ?? 0), 0);
      referralMap.set(refId, {
        referred_center_id: refCenterId,
        status: ref.status as string,
        months: monthCount,
        monthlyReward,
        total,
      });
    }
    const activeReferrals = referrals
      ? (referrals as { id: string }[]).map((r) => {
          const meta = referralMap.get(r.id);
          return {
            id: r.id,
            center_name: centerNames[meta?.referred_center_id ?? (r as { referred_center_id?: string }).referred_center_id ?? ''] ?? ',',
            status: meta?.status ?? (r as { status?: string }).status ?? 'pending',
            months: meta?.months ?? 0,
            monthly_reward: meta?.monthlyReward ?? 0,
            total: meta?.total ?? 0,
          };
        })
      : [];

    // Reward history
    const rewardHistory = records.map((r: { id: string; referred_center_id: string; referred_center_name?: string; month_number: number; reward_percentage: number; base_amount: number; reward_amount: number; status: string; held_until?: string; paid_at?: string; period_month: string }) => ({
      id: r.id,
      referred_center_id: r.referred_center_id,
      referred_center_name: centerNames[r.referred_center_id] ?? ',',
      month_number: r.month_number,
      reward_percentage: r.reward_percentage,
      base_amount: r.base_amount,
      reward_amount: r.reward_amount,
      status: r.status,
      held_until: r.held_until,
      paid_at: r.paid_at,
      period_month: r.period_month,
    }));

    // Payout requests
    const { data: payoutRequests } = await ctx.supabaseAdmin
      .from('payout_requests')
      .select('id, amount_requested, status, payment_method, requested_at, processed_at')
      .eq('center_id', centerId)
      .order('requested_at', { ascending: false });

    return NextResponse.json({
      referralCode: center?.referral_code ?? '',
      instapayNumber: typeof center?.instapay_number === 'string' ? center.instapay_number : '',
      totalEarned,
      available,
      pending,
      paidOut,
      totalReferrals: referrals?.length ?? 0,
      activeReferrals,
      rewardHistory,
      payoutRequests: payoutRequests ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
