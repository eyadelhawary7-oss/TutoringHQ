import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';

import {
  EARNED_STATUSES,
  earnedBalance,
  forfeitedBalance,
  heldBalance,
  paidBalance,
  withdrawableBalance,
} from '@/lib/referralCommissionStatus';

interface CommissionRow {
  id: string;
  referral_id: string;
  referred_center_id: string;
  months_since_activation: number;
  /** FRACTION, not percent: referral-automation writes 0.25 / 0.10 / 0.05. */
  commission_rate: number;
  referred_plan_fee: number;
  commission_amount: number;
  status: string;
  hold_until: string | null;
  paid_at: string | null;
  period_month: string;
  created_at: string;
}

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

    // `referral_commissions` — the canonical monthly commission ledger.
    //
    // D22: this read was `referral_reward_records`, whose only writer
    // (POST /api/referrals/calculate-rewards) had no cron registration and no
    // caller in src/, so every figure on this page was structurally 0. That
    // route was DELETED on 5 August 2026 and the table is dropped by hand.
    // `referral_commissions` is written monthly by /api/cron/referral-automation
    // — the only referral cron in vercel.json.
    //
    // Status vocabulary is the new table's: 'hold' | 'withdrawable' | 'paid' |
    // 'forfeited'. The old table's 'pending' and 'held' both meant "not yet
    // payable" and both map onto 'hold'; 'available' maps onto 'withdrawable'.
    const { data: commissionRows } = await ctx.supabaseAdmin
      .from('referral_commissions')
      .select('id, referral_id, referred_center_id, months_since_activation, commission_rate, referred_plan_fee, commission_amount, status, hold_until, paid_at, period_month, created_at')
      .eq('referrer_center_id', centerId)
      .order('period_month', { ascending: false });

    const records = (commissionRows || []) as CommissionRow[];

    // Earned = what the centre holds or has been paid. 'forfeited' is explicitly
    // NOT earned — it is commission lost when the referred centre failed to pay
    // in full, and it is reported on its own line instead of being folded in.
    const totalEarned = earnedBalance(records);
    const available = withdrawableBalance(records);
    const pending = heldBalance(records);
    const paidOut = paidBalance(records);
    const forfeited = forfeitedBalance(records);

    // Active referrals: group by referral
    const referralMap = new Map<string, { referred_center_id: string; status: string; months: number; monthlyReward: number; total: number }>();
    for (const ref of referrals || []) {
      const refId = ref.id as string;
      const refCenterId = ref.referred_center_id as string;
      const refRecords = records.filter((r) => r.referral_id === refId);
      const monthCount = refRecords.length > 0 ? Math.max(...refRecords.map((r) => r.months_since_activation)) : 0;
      // A forfeited month earned nothing (commission_amount 0), so it is excluded
      // from the average rather than dragging the per-month figure down.
      const earning = refRecords.filter((r) =>
        (EARNED_STATUSES as readonly string[]).includes(r.status),
      );
      const total = earning.reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);
      const monthlyReward = earning.length > 0 ? total / earning.length : 0;
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

    // Commission history. Field names are the canonical column names — the old
    // response used the retired table's names (month_number / reward_percentage /
    // base_amount / reward_amount / held_until), which is exactly the dual
    // vocabulary this change removes. Forfeited rows are RETAINED so the centre
    // can see what it lost; the page renders them greyed as "expired".
    const rewardHistory = records.map((r) => ({
      id: r.id,
      referred_center_id: r.referred_center_id,
      referred_center_name: centerNames[r.referred_center_id] ?? ',',
      months_since_activation: r.months_since_activation,
      commission_rate: r.commission_rate,
      referred_plan_fee: r.referred_plan_fee,
      commission_amount: r.commission_amount,
      status: r.status,
      hold_until: r.hold_until,
      paid_at: r.paid_at,
      period_month: r.period_month,
    }));

    // Payout requests
    const { data: payoutRequests } = await ctx.supabaseAdmin
      .from('payout_requests')
      .select('id, amount_requested, status, payment_method, requested_at, processed_at')
      .eq('center_id', centerId)
      .order('requested_at', { ascending: false });

    const processingFee = resolveProcessingFeeAmount(await getProcessingFeeConfig());

    return NextResponse.json({
      referralCode: center?.referral_code ?? '',
      instapayNumber: typeof center?.instapay_number === 'string' ? center.instapay_number : '',
      totalEarned,
      available,
      pending,
      paidOut,
      forfeited,
      processingFee,
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
